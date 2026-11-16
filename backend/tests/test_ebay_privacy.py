"""eBay exemption ("I do not persist eBay data"): no eBay user data is ever stored."""

import importlib.util
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import ListingRow, SavedRow
from rack.privacy import purge_ebay, scrub
from rack.sources.base import Listing, Seller
from rack.sources.ebay import RAW_KEYS, parse_search

BACKEND = Path(__file__).resolve().parent.parent
MIGRATION = BACKEND / "alembic" / "versions" / "0008_ebay_no_user_data.py"
FIXTURE = Path(__file__).parent / "fixtures" / "ebay" / "search_sample.json"
ALLOWED_RAW = set(RAW_KEYS) | {"localizedAspects", "shippingOptions", "itemLocation"}


def _payload() -> dict:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    # make sure every kind of user data is present in the input
    item = payload["itemSummaries"][0]
    item["itemLocation"] = {"city": "Hackney", "postalCode": "E8 1AA", "country": "GB"}
    item["localizedAspects"] = [
        {"name": "Brand", "value": "Maison Margiela"},
        {"name": "Seller notes", "value": "ask for example_seller_one on insta"},
    ]
    return payload


def test_parse_drops_all_user_data() -> None:
    listings = parse_search(_payload())
    assert listings
    for x in listings:
        assert x.seller is None and x.location is None
        assert set(x.raw) <= ALLOWED_RAW
        assert "seller" not in x.raw
        assert x.raw.get("itemLocation", {}).keys() <= {"country"}
        dumped = json.dumps(x.raw)
        assert "example_seller_one" not in dumped and "example_seller_two" not in dumped
        assert "Hackney" not in dumped and "E8 1AA" not in dumped
    gat = listings[0]
    # item data is all still there
    assert gat.country == "GB" and gat.brand == "Maison Margiela"
    assert gat.shipping_cost == Decimal("4.99") and len(gat.images) == 3
    assert gat.condition == "Pre-owned - Good" and gat.url.endswith("/itm/186712345678")


def test_scrub_is_ebay_only() -> None:
    vals: dict[str, object] = {
        "source": "ebay",
        "seller_name": "x",
        "seller_rating": 99.0,
        "seller_count": 5,
        "location": "Hackney, E8",
        "raw": {
            "title": "t",
            "seller": {"username": "x"},
            "itemLocation": {"city": "H", "country": "GB"},
        },
    }
    out = scrub(vals)
    assert out["seller_name"] is None and out["seller_rating"] is None
    assert out["seller_count"] is None and out["location"] is None
    assert out["raw"] == {"title": "t", "itemLocation": {"country": "GB"}}
    vinted = {**vals, "source": "vinted"}
    assert scrub(vinted) == vinted


def _ebay(sid: str, **kw: object) -> Listing:
    return Listing(
        source="ebay",
        source_id=sid,
        url=f"https://www.ebay.co.uk/itm/{sid}",
        title="Rick Owens Geobasket",
        price=Decimal("300"),
        currency="GBP",
        price_gbp=Decimal("300"),
        images=[f"https://i.ebayimg.com/images/g/{sid}/s-l1600.jpg"],
        **kw,  # type: ignore[arg-type]
    )


@pytest.mark.db
async def test_ingested_ebay_listing_stores_no_seller_fields(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    # even if an adapter regressed and handed us seller data, none of it reaches the DB
    leaky = _ebay(
        "1",
        seller=Seller(name="example_seller_one", rating=99.6, count=1342),
        location="Hackney, E8 1AA",
        country="GB",
        raw={"itemId": "1", "seller": {"username": "example_seller_one"}},
    )
    async with sessions() as s:
        await upsert_listings(s, parse_search(_payload()) + [leaky])
        await s.commit()
        rows = (await s.execute(select(ListingRow).where(ListingRow.source == "ebay"))).scalars()
        rows = list(rows)
    assert len(rows) == 3
    for r in rows:
        assert r.seller_name is None and r.seller_rating is None and r.seller_count is None
        assert r.location is None
        assert "seller" not in r.raw
        assert "example_seller_one" not in json.dumps(r.raw)
    assert {r.country for r in rows} == {"GB", "US"}


@pytest.mark.db
async def test_purge_deletes_inactive_and_stale_ebay_only(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    vinted = _ebay("v").model_copy(
        update={"source": "vinted", "url": "https://www.vinted.co.uk/items/1-x"}
    )
    async with sessions() as s:
        fresh, gone, stale, saved_live, old_vinted = await upsert_listings(
            s, [_ebay("fresh"), _ebay("gone"), _ebay("stale"), _ebay("saved"), vinted]
        )
        rows = {r.id: r for r in (await s.execute(select(ListingRow))).scalars()}
        rows[gone].active = False
        rows[stale].last_seen_at = now - timedelta(days=8)
        rows[saved_live].last_seen_at = now - timedelta(days=2)
        rows[old_vinted].last_seen_at = now - timedelta(days=30)
        s.add(SavedRow(listing_id=saved_live))
        await s.commit()

        assert await purge_ebay(s, 7, now) == 2
        await s.commit()
        left = set((await s.execute(select(ListingRow.id))).scalars())
    assert left == {fresh, saved_live, old_vinted}


@pytest.mark.db
async def test_migration_0008_cleans_existing_ebay_rows(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    # runs the migration's SQL directly: invoking Alembic here would reset logging for the
    # whole test session (env.py calls fileConfig)
    spec = importlib.util.spec_from_file_location("m0008", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    raw = {
        "itemId": "1",
        "title": "GAT",
        "price": {"value": "10", "currency": "GBP"},
        "seller": {"username": "example_seller_one", "feedbackScore": 1342},
        "itemLocation": {"city": "Hackney", "postalCode": "E8", "country": "GB"},
        "marketplaceId": "EBAY_GB",
    }
    async with sessions() as s:
        for source in ("ebay", "vinted"):
            await s.execute(
                text(
                    "INSERT INTO listings (source, source_id, url, title, price, currency, "
                    "seller_name, seller_rating, seller_count, location, raw, active, "
                    "first_seen_at, last_seen_at) VALUES (:src, '1', 'https://x/1', 'GAT', 10, "
                    "'GBP', 'example_seller_one', 99.6, 1342, 'Hackney', CAST(:raw AS jsonb), true, "
                    "now(), now())"
                ),
                {"src": source, "raw": json.dumps(raw)},
            )
        await s.commit()
    async with sessions() as s:
        await s.execute(text(migration.clean_sql()))
        await s.commit()
        rows = {r.source: r for r in (await s.execute(select(ListingRow))).scalars()}
    ebay = rows["ebay"]
    assert (ebay.seller_name, ebay.seller_rating, ebay.seller_count, ebay.location) == (
        None,
        None,
        None,
        None,
    )
    assert ebay.raw == {
        "itemId": "1",
        "title": "GAT",
        "price": {"value": "10", "currency": "GBP"},
        "itemLocation": {"country": "GB"},
    }
    assert rows["vinted"].seller_name == "example_seller_one"  # other sources untouched
