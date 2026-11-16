"""5c: Grailed sold prices (parsing, query), sold-first estimates, trends and snapshots."""

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import EstimateSnapshotRow, SoldListingRow, TasteItemRow
from rack.pricing.resale import estimate_item
from rack.pricing.trend import MIN_SALES, compute_trend, monthly_points, window_change
from rack.sources.base import Category
from rack.sources.grailed import (
    SOLD_INDEX,
    GrailedAdapter,
    SoldItem,
    build_sold_body,
    parse_sold,
)
from rack.worker.sold import fetch_sold
from tests.conftest import login
from tests.test_resale import BASE, COATS, _seed, vec

NOW = datetime(2026, 11, 16, 12, tzinfo=UTC)


def hit(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": 101,
        "title": "Rick Owens Geobasket",
        "sold": True,
        "sold_price": 520,
        "sold_shipping_price": 15.99,
        "sold_price_includes_shipping": False,
        "sold_at": "2026-11-15T22:10:42.001Z",
        "department": "menswear",
        "category": "footwear",
        "size": "43",
        "designers": [{"name": "Rick Owens"}],
        "cover_photo": {"url": "https://media-assets.grailed.com/prd/listing/1/a.jpg"},
        "user": {"username": "example_seller", "id": 9, "seller_score": {"rating_average": 5}},
        "price": 580,
    }
    return {**base, **kw}


# --- parsing and query ---


def test_parse_sold_keeps_item_data_only() -> None:
    sale = parse_sold(hit())
    assert sale is not None
    assert (sale.source_id, sale.brand, sale.category, sale.size) == (
        "101",
        "Rick Owens",
        Category.SHOES,
        "43",
    )
    assert sale.sold_at == datetime(2026, 11, 15, 22, 10, 42, 1000, tzinfo=UTC)
    assert Decimal("300") < sale.sold_price_gbp < Decimal("520")  # USD -> GBP
    assert "example_seller" not in json.dumps(sale.__dict__, default=str)


def test_parse_sold_rejects_and_adjusts() -> None:
    assert parse_sold(hit(sold=False)) is None
    assert parse_sold(hit(sold_price=None)) is None
    assert parse_sold(hit(department="womenswear")) is None
    assert parse_sold(hit(sold_at=None)) is None
    with_ship = parse_sold(
        hit(sold_price=100, sold_shipping_price=20, sold_price_includes_shipping=True)
    )
    without = parse_sold(hit(sold_price=80))
    assert with_ship and without and with_ship.sold_price_gbp == without.sold_price_gbp
    insecure = parse_sold(hit(cover_photo={"url": "http://x/a.jpg"}))
    assert insecure and insecure.image_url is None
    assert (parse_sold(hit(category="bags")) or SoldItem).category == Category.ANY  # type: ignore[union-attr]


def test_sold_query_body() -> None:
    since = NOW - timedelta(days=30)
    body = build_sold_body("Rick Owens", Category.SHOES, since, NOW, 40, ["geobasket", "rick"])
    assert body["query"] == "Rick Owens geobasket" and body["hitsPerPage"] == 40
    assert body["optionalWords"] == ["geobasket"]  # ranks geobaskets first, doesn't require it
    assert ["department:menswear"] in body["facetFilters"]
    assert ["category:footwear"] in body["facetFilters"]
    assert body["numericFilters"] == [
        f"sold_at_i>={int(since.timestamp())}",
        f"sold_at_i<{int(NOW.timestamp())}",
    ]
    assert "optionalWords" not in build_sold_body("Gucci", Category.ANY, since, NOW, 40)


async def test_search_sold_uses_the_sold_index() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"hits": [hit(), hit(id=102, sold=False)]})

    adapter = GrailedAdapter("APP", "key", min_interval=0, transport=httpx.MockTransport(handler))
    sales = await adapter.search_sold("Rick Owens", Category.ANY, NOW - timedelta(days=30), NOW)
    assert [s.source_id for s in sales] == ["101"]
    assert seen[0].url.path == f"/1/indexes/{SOLD_INDEX}/query"
    await adapter.aclose()


# --- trend (pure) ---


def sales(days_ago_and_price: list[tuple[int, int]]) -> list[tuple[datetime, Decimal]]:
    return [(NOW - timedelta(days=d), Decimal(p)) for d, p in days_ago_and_price]


def test_trend_needs_enough_sales_on_both_sides() -> None:
    recent = [(d, 600) for d in range(1, MIN_SALES + 1)]
    prior = [(d, 500) for d in range(31, 31 + MIN_SALES - 1)]  # one short
    assert window_change(sales(recent + prior), NOW, 30) is None
    prior.append((45, 500))
    up = window_change(sales(recent + prior), NOW, 30)
    assert up and up["direction"] == "up" and up["pct"] == 20.0
    assert (up["recent_sales"], up["prior_sales"]) == (5, 5)


def test_trend_down_and_steady() -> None:
    down = window_change(
        sales([(d, 400) for d in range(1, 6)] + [(d, 500) for d in range(40, 45)]), NOW, 30
    )
    assert down and down["direction"] == "down" and down["pct"] == -20.0
    flat = window_change(
        sales([(d, 510) for d in range(1, 6)] + [(d, 500) for d in range(40, 45)]), NOW, 30
    )
    assert flat and flat["direction"] == "steady"


def test_ninety_day_window_and_monthly_points() -> None:
    data = sales([(d, 500) for d in range(100, 170, 10)] + [(d, 650) for d in range(5, 85, 10)])
    t = compute_trend(data, NOW)
    assert t["90"] and t["90"]["direction"] == "up"
    assert t["30"] is None  # not enough sales in the last 60 days
    points = monthly_points(data, NOW)
    assert len(points) == 6 and points[-1]["end"] == "2026-11-16"
    assert all(
        p["median"] is None or Decimal(p["median"]) in (Decimal("500.00"), Decimal("650.00"))
        for p in points
    )


# --- database ---


async def _sold_rows(
    sessions: async_sessionmaker[AsyncSession], rows: list[tuple[str, int, float, int]]
) -> None:
    """(brand, price £, cosine to BASE, days ago)"""
    async with sessions() as s:
        for i, (brand, price, cos, ago) in enumerate(rows):
            s.add(
                SoldListingRow(
                    source="grailed",
                    source_id=f"s{i}",
                    title=f"{brand} leather jacket",
                    brand=brand,
                    category="outerwear",
                    sold_price_gbp=Decimal(price),
                    sold_at=NOW - timedelta(days=ago),
                    image_url=f"https://media-assets.grailed.com/{i}.jpg",
                    embedding=vec(cos),
                    fetched_at=NOW,
                )
            )
        await s.commit()


async def _item(sessions: async_sessionmaker[AsyncSession]) -> int:
    async with sessions() as s:
        item = TasteItemRow(kind="wardrobe", text="leather jacket", brand="Rick Owens")
        item.embedding = BASE
        s.add(item)
        await s.commit()
        return item.id


@pytest.mark.db
async def test_sold_prices_win_when_there_are_enough(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(sessions, COATS)  # asking prices: 800, 600, 700 -> 700
    recent = [
        ("Rick Owens", p, 0.9, d) for p, d in [(400, 2), (450, 5), (500, 9), (550, 20), (600, 25)]
    ]
    older = [("Rick Owens", 300, 0.9, d) for d in (40, 45, 50, 55, 58)]
    other = [
        ("Maison Margiela", 9000, 0.95, 3),
        ("Rick Owens", 9000, 0.2, 3),
    ]  # wrong brand / photo
    await _sold_rows(sessions, recent + older + other)
    item_id = await _item(sessions)
    async with sessions() as s:
        item = await s.get(TasteItemRow, item_id)
        assert item is not None
        await estimate_item(s, item, [], NOW)
        await s.commit()
        assert (item.estimate_kind, item.estimate_gbp) == ("sold", Decimal("350.00"))
        # 90 days: 10 similar sales -> median of (400,450,500,550,600,300*5) = 350
        assert item.estimate_count == 10 and item.estimate_gbp is not None
        assert item.trend and item.trend["30"]["direction"] == "up"  # 500 now vs 300 before
        assert item.trend["30"]["pct"] == pytest.approx(66.7, abs=0.1)

        await estimate_item(s, item, [], NOW + timedelta(hours=2))  # same day: one snapshot
        await s.commit()
        snaps = (await s.execute(select(EstimateSnapshotRow))).scalars().all()
        assert len(snaps) == 1 and snaps[0].kind == "sold"


@pytest.mark.db
async def test_falls_back_to_asking_prices(sessions: async_sessionmaker[AsyncSession]) -> None:
    await _seed(sessions, COATS)
    await _sold_rows(sessions, [("Rick Owens", 400, 0.9, d) for d in (2, 5, 9, 20)])  # only 4
    item_id = await _item(sessions)
    async with sessions() as s:
        item = await s.get(TasteItemRow, item_id)
        assert item is not None
        await estimate_item(s, item, [], NOW)
        assert (item.estimate_kind, item.estimate_gbp) == ("asking", Decimal("700.00"))
        assert item.trend and item.trend["30"] is None  # too few sales for a trend


class FakeGrailed(GrailedAdapter):
    def __init__(self) -> None:
        super().__init__("APP", "key")
        self.asked: list[tuple[str, Category]] = []
        self.slices: list[tuple[datetime, datetime]] = []
        self.words: list[str] = []

    async def search_sold(
        self,
        brand: str,
        category: Category,
        since: datetime,
        until: datetime,
        limit: int = 40,
        words: Sequence[str] = (),
    ) -> list[SoldItem]:
        self.asked.append((brand, category))
        self.slices.append((since, until))
        self.words = list(words)
        return [
            s for s in (parse_sold(hit(id=i, title=f"Rick Owens jacket {i}")) for i in (1, 2)) if s
        ]


@pytest.mark.db
async def test_fetch_sold_once_a_day_for_branded_items(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    item_id = await _item(sessions)
    async with sessions() as s:
        anon = TasteItemRow(kind="wardrobe", text="mystery coat")
        anon.embedding = BASE
        s.add(anon)
        await s.commit()
    adapter = FakeGrailed()
    assert await fetch_sold(sessions, adapter, NOW) == 2
    # six 30-day slices back to 180 days, "jacket" -> outerwear, label words rank similar items
    assert adapter.asked == [("Rick Owens", Category.OUTERWEAR)] * 6
    assert adapter.slices[0] == (NOW - timedelta(days=30), NOW)
    assert adapter.slices[-1] == (NOW - timedelta(days=180), NOW - timedelta(days=150))
    assert adapter.words == ["leather", "jacket"]
    assert await fetch_sold(sessions, adapter, NOW + timedelta(hours=1)) == 0  # not due again
    assert await fetch_sold(sessions, adapter, NOW + timedelta(days=1, hours=1)) == 0  # dupes
    assert len(adapter.asked) == 12
    async with sessions() as s:
        rows = (await s.execute(select(SoldListingRow))).scalars().all()
        assert {r.source_id for r in rows} == {"1", "2"}
        assert "example_seller" not in json.dumps([r.title for r in rows])
        item = await s.get(TasteItemRow, item_id)
        assert item is not None and item.estimate_at is None  # re-estimate with the new sales


@pytest.mark.db
async def test_api_shows_sold_kind_trend_and_sold_comparables(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    await _sold_rows(
        sessions, [("Rick Owens", 400 + i * 10, 0.95 - i * 0.01, i + 1) for i in range(6)]
    )
    item_id = await _item(sessions)
    async with sessions() as s:
        item = await s.get(TasteItemRow, item_id)
        assert item is not None
        await estimate_item(s, item, [], datetime.now(UTC))
        await s.commit()
    out = (await client.get("/api/taste?kind=wardrobe")).json()[0]
    assert out["estimate_kind"] == "sold" and out["trend"]["points"]
    comps = (await client.get(f"/api/taste/{item_id}/comparables")).json()
    assert len(comps) == 3 and comps[0]["sold_at"] and comps[0]["similarity"] == 0.95
    assert comps[0]["url"].startswith("https://www.grailed.com/listings/s")
    async with sessions() as s:
        assert (
            await s.execute(select(func.count()).select_from(EstimateSnapshotRow))
        ).scalar() == 1
