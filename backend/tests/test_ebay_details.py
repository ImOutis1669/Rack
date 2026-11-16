"""eBay getItem enrichment, sticky exclusion of women's items, and the usage line in health."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api.feed import ebay_usage_text
from rack.ingest import upsert_listings
from rack.models import ListingRow
from rack.privacy import purge_ebay
from rack.sources.ebay import EbayAdapter, parse_search
from rack.worker.ebay_details import fetch_ebay_details

FIX = Path(__file__).parent / "fixtures" / "ebay"


def _json(name: str) -> dict[str, Any]:
    return json.loads((FIX / name).read_text(encoding="utf-8"))


class FakeEbay(EbayAdapter):
    def __init__(self, items: dict[str, dict[str, Any] | None]) -> None:
        super().__init__("id", "secret")
        self.items = items
        self.asked: list[str] = []

    async def fetch_item(self, url_or_id: str) -> dict[str, Any] | None:
        self.asked.append(url_or_id)
        self._count("item")
        return self.items.get(url_or_id)


def test_usage_text() -> None:
    today = "2026-11-16"
    assert ebay_usage_text({}, 5000, today) == (None, False)
    assert ebay_usage_text({"day": "2026-11-15", "search": 9}, 5000, today) == (None, False)
    assert ebay_usage_text({"day": today, "search": 412}, 5000, today) == (
        "412 of 5,000 searches today",
        False,
    )
    text, warn = ebay_usage_text({"day": today, "search": 4100, "item": 300}, 5000, today)
    assert text == "4,100 of 5,000 searches today · 300 item lookups" and warn


@pytest.mark.db
async def test_details_fill_size_brand_and_exclude_womens_for_good(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    gat_item = _json("item_sample.json")
    tee_id = "v1|395512345678|0"
    womens = {
        **gat_item,
        "itemId": tee_id,
        "categoryPath": "Clothes, Shoes & Accessories|Women|Women's Clothing",
    }
    adapter = FakeEbay({"v1|186712345678|0": gat_item, tee_id: womens})
    async with sessions() as s:
        await upsert_listings(s, parse_search(_json("search_sample.json")))
        await s.commit()

    n = await fetch_ebay_details(sessions, adapter, daily_cap=1000, batch=20, now=now)
    assert n == 2
    async with sessions() as s:
        rows = {r.source_id: r for r in (await s.execute(select(ListingRow))).scalars()}
    gat, tee = rows["v1|186712345678|0"], rows[tee_id]
    assert (gat.brand, gat.size, gat.active) == ("Maison Margiela", "12", True)
    assert gat.description == "Worn a handful of times, original box."
    assert gat.seller_name is None and gat.location is None and "seller" not in gat.raw
    assert len(gat.images) == 4
    assert (tee.active, tee.excluded) == (False, "womens")

    # nothing left to look up; a new search keeps getItem's size/brand and the exclusion
    assert await fetch_ebay_details(sessions, adapter, daily_cap=1000, batch=20, now=now) == 0
    async with sessions() as s:
        await upsert_listings(s, parse_search(_json("search_sample.json")))
        await s.commit()
        rows = {r.source_id: r for r in (await s.execute(select(ListingRow))).scalars()}
        assert rows["v1|186712345678|0"].size == "12"
        assert rows["v1|186712345678|0"].brand == "Maison Margiela"
        assert rows[tee_id].active is False

        # retention keeps an excluded listing while searches still return it (no re-fetch loop)
        assert await purge_ebay(s, 7, now) == 0
        rows[tee_id].last_seen_at = now - timedelta(days=8)
        await s.commit()
        assert await purge_ebay(s, 7, now) == 1
        await s.commit()
    assert adapter.asked.count(tee_id) == 1


@pytest.mark.db
async def test_details_respect_the_daily_cap_and_gone_items(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    adapter = FakeEbay({})  # every lookup: gone
    async with sessions() as s:
        await upsert_listings(s, parse_search(_json("search_sample.json")))
        await s.commit()
    adapter.usage["item"] = 999
    assert await fetch_ebay_details(sessions, adapter, daily_cap=1000, batch=20, now=now) == 1
    assert await fetch_ebay_details(sessions, adapter, daily_cap=1000, batch=20, now=now) == 0
    async with sessions() as s:
        gone = (await s.execute(select(ListingRow).where(ListingRow.active.is_(False)))).scalars()
        assert [r.excluded for r in gone] == [None]  # gone, not excluded: retention deletes it
