"""Look each new eBay listing up once with getItem (search summaries lack size, brand, department).

Runs every couple of minutes in small batches, newest first, within a daily cap on getItem calls.
getItem returns seller data too; only item fields are copied (see rack.sources.ebay / privacy).
"""

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import set_images
from rack.models import ListingRow
from rack.sources.base import SourceError
from rack.sources.ebay import EbayAdapter, is_womens, parse_item
from rack.store import mark_listings_changed

log = logging.getLogger(__name__)


async def fetch_ebay_details(
    sessions: async_sessionmaker[AsyncSession],
    adapter: EbayAdapter,
    *,
    daily_cap: int,
    batch: int,
    now: datetime,
) -> int:
    """Returns how many listings were looked up."""
    if not adapter.configured:
        return 0
    room = min(batch, daily_cap - adapter.calls_today("item"))
    if room <= 0:
        return 0
    done = 0
    async with sessions() as s:
        rows = (
            (
                await s.execute(
                    select(ListingRow)
                    .where(
                        ListingRow.source == "ebay",
                        ListingRow.active.is_(True),
                        ListingRow.details_fetched_at.is_(None),
                    )
                    .order_by(ListingRow.first_seen_at.desc())
                    .limit(room)
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            try:
                item = await adapter.fetch_item(row.source_id)
            except SourceError as exc:
                log.warning("eBay getItem failed for %s: %s", row.source_id, exc)
                break  # try again next run (likely quota or an outage)
            done += 1
            row.details_fetched_at = now
            if item is None:
                row.active = False  # gone: retention deletes it
            elif is_womens(item):
                row.active = False
                row.excluded = "womens"
            elif (fresh := parse_item(item)) is not None:
                row.size = fresh.size or row.size
                row.brand = fresh.brand or row.brand
                row.description = fresh.description or row.description
                await set_images(s, row.id, row.images, fresh.images)
            await s.commit()
        if done:  # sizes/brands changed: rescore
            await mark_listings_changed(s)
            await s.commit()
    return done
