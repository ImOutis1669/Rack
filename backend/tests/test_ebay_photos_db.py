"""eBay photos are stored full size, and migration 0016 backfills the 225 px rows."""

import importlib.util
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import set_images, upsert_listings, url_hash
from rack.models import ListingImageRow, ListingRow
from rack.sources.ebay import parse_item

pytestmark = pytest.mark.db

G = "https://i.ebayimg.com/images/g"
MIGRATION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0016_ebay_full_size_photos.py"


def summary(*photo_ids: str, size: str) -> dict:
    return {
        "itemId": "v1|42|0",
        "title": "Rick Owens jacket",
        "itemWebUrl": "https://www.ebay.co.uk/itm/42",
        "price": {"value": "300.00", "currency": "GBP"},
        "image": {"imageUrl": f"{G}/{photo_ids[0]}/{size}.jpg"},
        "additionalImages": [{"imageUrl": f"{G}/{p}/{size}.jpg"} for p in photo_ids[1:]],
    }


async def photos(s: AsyncSession, listing_id: int) -> list[str]:
    rows = (
        await s.execute(
            select(ListingImageRow).where(ListingImageRow.listing_id == listing_id).order_by(ListingImageRow.position)
        )
    ).scalars()
    return [r.url for r in rows]


async def test_search_refresh_no_longer_swaps_a_getitem_gallery_back(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    search = parse_item(summary("a", "b", size="s-l225"))
    detail = parse_item(summary("a", "b", "c", size="s-l1600"))
    assert search and detail
    async with sessions() as s:
        await upsert_listings(s, [search])
        await s.commit()
        row = (await s.execute(select(ListingRow))).scalar_one()
        await s.refresh(row, ["images"])
        await set_images(s, row.id, row.images, detail.images)  # what ebay_details does
        await s.commit()
        first_ids = [i.id for i in (await s.execute(select(ListingImageRow))).scalars()]
        await upsert_listings(s, [search])  # the next search refresh
        await s.commit()
        assert await photos(s, row.id) == [f"{G}/a/s-l1600.jpg", f"{G}/b/s-l1600.jpg", f"{G}/c/s-l1600.jpg"]
        # same rows kept (their embeddings too), not replaced
        assert sorted(i.id for i in (await s.execute(select(ListingImageRow))).scalars()) == sorted(first_ids)


async def test_migration_0016_rewrites_old_rows_and_drops_duplicates(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with sessions() as s:
        now = datetime.now(UTC)
        lst = ListingRow(
            source="ebay", source_id="v1|7|0", url="https://www.ebay.co.uk/itm/7", title="Coat",
            price=Decimal("50"), currency="GBP", first_seen_at=now, last_seen_at=now,
        )
        other = ListingRow(
            source="vinted", source_id="9", url="https://www.vinted.co.uk/items/9", title="Tee",
            price=Decimal("5"), currency="GBP", first_seen_at=now, last_seen_at=now,
        )
        s.add_all([lst, other])
        await s.flush()
        old = [f"{G}/a/s-l225.jpg", f"{G}/b/s-l225.jpg", f"{G}/a/s-l1600.jpg", "https://i.vendoo.co/i/x.jpeg"]
        for pos, url in enumerate(old):
            s.add(ListingImageRow(listing_id=lst.id, position=pos, url=url, url_hash=url_hash(url), phash="ff"))
        vinted = "https://images1.vinted.net/t/x/s-l225.jpg"  # not eBay: untouched
        s.add(ListingImageRow(listing_id=other.id, position=0, url=vinted, url_hash=url_hash(vinted)))
        await s.commit()

        spec = importlib.util.spec_from_file_location("m0016", MIGRATION)
        assert spec and spec.loader
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        for sql in (m.DROP_DUPLICATES, m.REWRITE, m.RENUMBER):
            await s.execute(text(sql))
        await s.commit()

        rows = (
            await s.execute(
                select(ListingImageRow).where(ListingImageRow.listing_id == lst.id).order_by(ListingImageRow.position)
            )
        ).scalars().all()
        assert [(r.position, r.url) for r in rows] == [
            (0, f"{G}/a/s-l1600.jpg"),
            (1, f"{G}/b/s-l1600.jpg"),
            (2, "https://i.vendoo.co/i/x.jpeg"),
        ]
        assert all(r.url_hash == url_hash(r.url) for r in rows)  # SQL sha256 == Python's
        assert rows[0].phash == "ff"  # same photo: pHash (and embedding) kept
        assert await photos(s, other.id) == [vinted]
