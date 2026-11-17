"""Minimal Wardrobe: name, purchase date and category; backfill; bought items keep their link."""

import importlib.util
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api import purchases
from rack.ingest import upsert_listings
from rack.models import ListingRow, TasteItemRow
from rack.sources.base import Listing
from tests.conftest import login
from tests.fakes import png

pytestmark = pytest.mark.db
H = {"X-Requested-With": "rack"}
MIGRATION = (
    Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0015_wardrobe_details.py"
)


async def test_backfill_moves_photo_labels_to_name_and_dates_purchases(
    sessions: async_sessionmaker[AsyncSession], owner_id: int
) -> None:
    spec = importlib.util.spec_from_file_location("m0015", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    bought_at = datetime(2026, 11, 16, 23, 30, tzinfo=UTC)
    async with sessions() as s:
        rows = [
            TasteItemRow(user_id=owner_id, kind="wardrobe", image_path="a.jpg", note="Gucci GG belt"),
            TasteItemRow(user_id=owner_id, kind="wardrobe", text="black overcoat", note="my favourite"),
            TasteItemRow(
                user_id=owner_id, kind="wardrobe", image_path="b.jpg", text="Junya jacket", purchased_at=bought_at
            ),
            TasteItemRow(user_id=owner_id, kind="wishlist", image_path="c.jpg"),
        ]
        s.add_all(rows)
        await s.commit()
        await s.execute(text(migration.BACKFILL))
        await s.commit()
        got = {}
        for r in rows:
            await s.refresh(r)
            got[r.id] = (r.name, r.note, r.purchase_date)
    belt, coat, jacket, wish = (got[r.id] for r in rows)
    assert belt == ("Gucci GG belt", None, None)  # the photo's label becomes its name
    assert coat == ("black overcoat", "my favourite", None)  # a real note stays a note
    assert jacket == ("Junya jacket", None, date(2026, 11, 16))
    assert wish == (None, None, None)


async def test_edit_fields_and_validation(client: httpx.AsyncClient) -> None:
    await login(client)
    item = (
        await client.post(
            "/api/taste/text", json={"kind": "wardrobe", "text": "overcoat"}, headers=H
        )
    ).json()
    assert item["name"] == "overcoat" and item["effective_category"] == "outerwear"
    body = {
        "name": "Lemaire wool overcoat",
        "brand": "Lemaire",
        "size": "M",
        "category": "outerwear",
        "purchase_date": "2025-03-01",
        "purchase_price_gbp": "420",
        "note": "dry clean only",
    }
    r = await client.patch(f"/api/taste/{item['id']}", json=body, headers=H)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["name"], out["brand"], out["size"], out["category"]) == (
        "Lemaire wool overcoat",
        "Lemaire",
        "M",
        "outerwear",
    )
    assert out["purchase_date"] == "2025-03-01" and out["note"] == "dry clean only"
    assert out["text"] == "overcoat"  # the feed's taste text is untouched

    cleared = (
        await client.patch(
            f"/api/taste/{item['id']}",
            json={"category": None, "size": "", "purchase_date": None},
            headers=H,
        )
    ).json()
    assert (cleared["category"], cleared["size"], cleared["purchase_date"]) == (None, None, None)
    assert cleared["effective_category"] == "outerwear"  # worked out from the name again

    tomorrow2 = (date.today() + timedelta(days=3)).isoformat()
    for bad in (
        {"purchase_date": tomorrow2},
        {"purchase_date": "1900-01-01"},
        {"category": "hats"},
    ):
        assert (
            await client.patch(f"/api/taste/{item['id']}", json=bad, headers=H)
        ).status_code == 422


async def test_wishlist_items_have_no_purchase_date_but_can_be_named(
    client: httpx.AsyncClient,
) -> None:
    await login(client)
    item = (
        await client.post(
            "/api/taste/text", json={"kind": "wishlist", "text": "tabi boots"}, headers=H
        )
    ).json()
    ok = await client.patch(
        f"/api/taste/{item['id']}",
        json={"name": "Margiela tabi boots", "brand": "Maison Margiela"},
        headers=H,
    )
    assert ok.status_code == 200 and ok.json()["brand"] == "Maison Margiela"
    bad = await client.patch(
        f"/api/taste/{item['id']}", json={"purchase_date": "2025-01-01"}, headers=H
    )
    assert bad.status_code == 400


async def test_bought_items_are_named_dated_and_keep_their_link(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_download(url: str) -> bytes:
        return png("black")

    monkeypatch.setattr(purchases, "download_photo", fake_download)
    await login(client)
    async with sessions() as s:
        [lid] = await upsert_listings(
            s,
            [
                Listing(
                    source="vinted",
                    source_id="77",
                    url="https://www.vinted.co.uk/items/77-junya",
                    title="Junya Watanabe varsity jacket",
                    price=Decimal("184"),
                    currency="GBP",
                    price_gbp=Decimal("184"),
                    images=["https://images1.vinted.net/t/77/a.jpeg"],
                )
            ],
        )
        await s.commit()
    item = (
        await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "184"}, headers=H)
    ).json()
    assert item["name"] == "Junya Watanabe varsity jacket"
    assert item["purchase_date"] == datetime.now(UTC).date().isoformat()

    async with sessions() as s:  # the listing is cleaned up (sold, retention...)
        await s.execute(delete(ListingRow).where(ListingRow.id == lid))
        await s.commit()
    after = (await client.get("/api/taste?kind=wardrobe")).json()[0]
    assert after["listing_id"] is None
    assert after["listing_url"] == "https://www.vinted.co.uk/items/77-junya"  # link kept
    assert after["source"] == "vinted"
