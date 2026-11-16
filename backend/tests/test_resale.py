"""Estimated resale value (5b): comparables, median, confidence, and the API around it."""

import math
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import DesignerRow, ListingImageRow, ListingScoreRow, TasteItemRow
from rack.pricing.resale import (
    MIN_SIMILARITY,
    Comparable,
    confidence,
    estimate_from,
    estimate_item,
)
from rack.sources.base import Listing
from rack.worker.resale import refresh_estimates
from tests.conftest import login

H = {"X-Requested-With": "rack"}
DIM = 512


def vec(cos: float) -> list[float]:
    """Unit vector at cosine `cos` from the base vector e0."""
    v = [0.0] * DIM
    v[0], v[1] = cos, math.sqrt(max(0.0, 1 - cos * cos))
    return v


BASE = vec(1.0)


def comp(i: int, sim: float, price: str) -> Comparable:
    return Comparable(i, sim, Decimal(price))


# --- pure ---


def test_median_of_the_closest_matches() -> None:
    est = estimate_from([comp(1, 0.95, "100"), comp(2, 0.9, "300"), comp(3, 0.85, "200")])
    assert est.value_gbp == Decimal("200.00") and est.count == 3
    even = estimate_from([comp(i, 0.9, p) for i, p in enumerate(["100", "200", "300", "400"])])
    assert even.value_gbp == Decimal("250.00")


def test_needs_enough_similar_listings() -> None:
    est = estimate_from([comp(1, 0.95, "100"), comp(2, 0.9, "300"), comp(3, 0.5, "999")])
    assert est.value_gbp is None and est.count == 2  # the 0.5 one isn't similar enough
    assert MIN_SIMILARITY > 0.5


def test_keeps_only_the_closest_fifteen() -> None:
    many = [comp(i, 0.99 - i * 0.001, "100") for i in range(15)] + [comp(99, 0.81, "9000")]
    est = estimate_from(many)
    assert est.count == 15 and est.value_gbp == Decimal("100.00")
    assert 99 not in [c.listing_id for c in est.comparables]


def test_confidence_bands() -> None:
    assert [confidence(n) for n in (2, 3, 4, 5, 9, 10, 15)] == [
        None,
        "low",
        "low",
        "medium",
        "medium",
        "high",
        "high",
    ]


# --- database ---


def _listing(sid: str, title: str, brand: str | None, price: str) -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=title,
        brand=brand,
        price=Decimal(price),
        currency="GBP",
        price_gbp=Decimal(price),
        images=[f"https://images1.vinted.net/t/{sid}/a.jpeg"],
    )


async def _seed(
    sessions: async_sessionmaker[AsyncSession],
    rows: list[tuple[str, str, str | None, str, float, str]],
) -> dict[str, int]:
    """(sid, title, brand, price, cosine to BASE, category) -> listing ids by sid."""
    async with sessions() as s:
        ids = await upsert_listings(s, [_listing(r[0], r[1], r[2], r[3]) for r in rows])
        for lid, (_, _, _, _, cos, cat) in zip(ids, rows, strict=True):
            img = (
                await s.execute(select(ListingImageRow).where(ListingImageRow.listing_id == lid))
            ).scalar_one()
            img.embedding = vec(cos)
            s.add(
                ListingScoreRow(
                    listing_id=lid,
                    score=0.5,
                    components={},
                    category=cat,
                    measurements={},
                    profile_version=1,
                )
            )
        await s.commit()
    return {r[0]: lid for r, lid in zip(rows, ids, strict=True)}


COATS = [
    ("1", "Rick Owens leather jacket", "Rick Owens", "800", 0.95, "outerwear"),
    ("2", "Rick Owens bomber jacket", "Rick Owens", "600", 0.92, "outerwear"),
    ("3", "RICK OWENS jacket black", None, "700", 0.90, "outerwear"),  # brand from the title
    ("4", "Rick Owens geobasket", "Rick Owens", "500", 0.97, "shoes"),  # other category
    ("5", "Margiela leather jacket", "Maison Margiela", "2000", 0.96, "outerwear"),  # other brand
    ("6", "Rick Owens style jacket", None, "40", 0.96, "outerwear"),  # look-alike
    ("7", "Rick Owens denim jacket", "Rick Owens", "9999", 0.30, "outerwear"),  # not similar
]


@pytest.mark.db
async def test_estimate_uses_same_brand_category_and_similar_photos(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    ids = await _seed(sessions, COATS)
    now = datetime.now(UTC)
    async with sessions() as s:
        item = TasteItemRow(kind="wardrobe", text="black leather jacket", brand="Rick Owens")
        item.embedding = BASE
        s.add(item)
        await s.flush()
        est = await estimate_item(s, item, [], now)
        await s.commit()
    assert est is not None
    used = {c.listing_id for c in est.comparables}
    assert used == {ids["1"], ids["2"], ids["3"]}
    assert est.value_gbp == Decimal("700.00") and est.count == 3
    assert item.estimate_gbp == Decimal("700.00") and item.estimate_at == now
    assert item.estimate_basis and item.estimate_basis["brand"] == "Rick Owens"


@pytest.mark.db
async def test_brand_from_your_designers_and_none_without_one(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(sessions, COATS)
    now = datetime.now(UTC)
    async with sessions() as s:
        s.add(DesignerRow(name="Rick Owens", weight="love"))
        named = TasteItemRow(kind="wardrobe", text="my rick owens leather jacket")
        named.embedding = BASE
        anon = TasteItemRow(kind="wardrobe", text="black leather jacket")
        anon.embedding = BASE
        s.add_all([named, anon])
        await s.commit()
    assert await refresh_estimates(sessions, now) == 2
    async with sessions() as s:
        rows = {r.text: r for r in (await s.execute(select(TasteItemRow))).scalars()}
    assert rows["my rick owens leather jacket"].estimate_gbp == Decimal("700.00")
    anon_row = rows["black leather jacket"]
    assert anon_row.estimate_gbp is None and anon_row.estimate_count is None
    assert anon_row.estimate_at == now
    assert await refresh_estimates(sessions, now) == 0  # nothing due again for 6 hours


@pytest.mark.db
async def test_api_brand_patch_resets_and_comparables(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    ids = await _seed(sessions, COATS)
    item_id = (
        await client.post(
            "/api/taste/text", json={"kind": "wardrobe", "text": "leather jacket"}, headers=H
        )
    ).json()["id"]
    async with sessions() as s:
        row = await s.get(TasteItemRow, item_id)
        assert row is not None
        row.embedding = BASE
        await s.commit()

    r = await client.patch(f"/api/taste/{item_id}", json={"brand": "Rick Owens"}, headers=H)
    assert r.status_code == 200 and r.json()["brand"] == "Rick Owens"
    assert await refresh_estimates(sessions, datetime.now(UTC)) == 1

    out = (await client.get("/api/taste?kind=wardrobe")).json()[0]
    assert Decimal(out["estimate_gbp"]) == Decimal("700")
    assert (out["estimate_count"], out["estimate_brand"]) == (3, "Rick Owens")

    comps = (await client.get(f"/api/taste/{item_id}/comparables")).json()
    assert [c["id"] for c in comps] == [ids["1"], ids["2"], ids["3"]]  # closest first
    assert comps[0]["image"].startswith("https://") and comps[0]["similarity"] == 0.95

    # a new brand makes it due again
    await client.patch(f"/api/taste/{item_id}", json={"brand": "Maison Margiela"}, headers=H)
    async with sessions() as s:
        row = await s.get(TasteItemRow, item_id)
        assert row is not None and row.estimate_at is None


@pytest.mark.db
async def test_the_listing_you_bought_it_from_is_not_a_comparable(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    ids = await _seed(sessions, COATS)
    async with sessions() as s:
        item = TasteItemRow(
            kind="wardrobe", text="leather jacket", brand="Rick Owens", listing_id=ids["1"]
        )
        item.embedding = BASE
        s.add(item)
        await s.flush()
        est = await estimate_item(s, item, [], datetime.now(UTC))
    assert est is not None and ids["1"] not in {c.listing_id for c in est.comparables}
    assert est.count == 2 and est.value_gbp is None  # only two left: not enough
