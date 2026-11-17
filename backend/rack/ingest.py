"""Persist normalised listings and record per-source health."""

import hashlib
from collections.abc import Sequence
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import ListingImageRow, ListingRow, SourceHealthRow, utcnow
from rack.pricing.fx import to_gbp
from rack.pricing.history import record_price
from rack.privacy import scrub
from rack.sources.base import Listing


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _row_values(listing: Listing) -> dict[str, object]:
    return scrub(_listing_values(listing))


def _listing_values(listing: Listing) -> dict[str, object]:
    seller = listing.seller
    return {
        "source": listing.source,
        "source_id": listing.source_id,
        "url": listing.url,
        "title": listing.title,
        "description": listing.description,
        "brand": listing.brand,
        "price": listing.price,
        "currency": listing.currency,
        "price_gbp": listing.price_gbp,
        "shipping_cost_gbp": to_gbp(listing.shipping_cost, listing.currency)
        if listing.shipping_cost is not None
        else None,
        "size": listing.size,
        "condition": listing.condition,
        "seller_name": seller.name if seller else None,
        "seller_rating": seller.rating if seller else None,
        "seller_count": seller.count if seller else None,
        "listed_at": listing.listed_at,
        "location": listing.location,
        "country": listing.country,
        "raw": listing.raw,
        "active": True,
        "last_seen_at": utcnow(),
    }


async def upsert_listings(session: AsyncSession, listings: Sequence[Listing]) -> list[int]:
    """Insert or update listings by (source, source_id). Returns listing ids. Caller commits."""
    ids: list[int] = []
    for listing in listings:
        values = _row_values(listing)
        ins = insert(ListingRow).values(**values, first_seen_at=utcnow())
        update_cols: dict[str, Any] = {
            k: ins.excluded[k] for k in values if k not in ("source", "source_id")
        }
        # search results often lack the description we fetched from the item page: keep it
        update_cols["description"] = func.coalesce(ins.excluded.description, ListingRow.description)
        # item-page lookups know more than search results: keep their size/brand
        update_cols["size"] = func.coalesce(ListingRow.size, ins.excluded.size)
        update_cols["brand"] = func.coalesce(ListingRow.brand, ins.excluded.brand)
        # an excluded listing (e.g. women's) stays hidden however often a search returns it
        update_cols["active"] = case((ListingRow.excluded.is_(None), True), else_=False)
        upsert = ins.on_conflict_do_update(
            constraint="uq_listing_source", set_=update_cols
        ).returning(ListingRow.id)
        listing_id = (await session.execute(upsert)).scalar_one()
        ids.append(listing_id)
        await record_price(session, listing_id, listing.price_gbp)

        existing = (
            (
                await session.execute(
                    select(ListingImageRow).where(ListingImageRow.listing_id == listing_id)
                )
            )
            .scalars()
            .all()
        )
        await set_images(session, listing_id, existing, listing.images)
    await session.flush()
    return ids


async def set_images(
    session: AsyncSession, listing_id: int, existing: Sequence[ListingImageRow], urls: list[str]
) -> None:
    """Update a listing's photos without throwing away work.

    Same first photo: keep every existing row (and its embedding/pHash) and append new URLs — a
    search result showing 1 photo must not wipe the full gallery fetched from the item page.
    Different first photo: the listing's photos really changed, so replace them.
    """
    current = sorted(existing, key=lambda i: i.position)
    if current and urls and current[0].url == urls[0]:
        have = {i.url for i in current}
        pos = len(current)
        for url in urls:
            if url not in have:
                session.add(
                    ListingImageRow(
                        listing_id=listing_id, position=pos, url=url, url_hash=url_hash(url)
                    )
                )
                have.add(url)
                pos += 1
        return
    if [i.url for i in current] == urls:
        return
    for img in current:
        await session.delete(img)
    await session.flush()
    for pos, url in enumerate(urls):
        session.add(
            ListingImageRow(listing_id=listing_id, position=pos, url=url, url_hash=url_hash(url))
        )


async def _health(session: AsyncSession, source: str) -> SourceHealthRow:
    row = await session.get(SourceHealthRow, source)
    if row is None:
        row = SourceHealthRow(source=source, error_count=0, consecutive_errors=0)
        session.add(row)
    return row


async def record_success(session: AsyncSession, source: str, count: int) -> None:
    row = await _health(session, source)
    row.configured = True
    row.blocked = False
    row.last_success_at = utcnow()
    row.consecutive_errors = 0
    row.last_result_count = count


async def record_error(session: AsyncSession, source: str, error: str) -> None:
    row = await _health(session, source)
    row.configured = True
    row.last_error_at = utcnow()
    row.last_error = error[:1000]
    row.error_count = (row.error_count or 0) + 1
    row.consecutive_errors = (row.consecutive_errors or 0) + 1


async def record_not_configured(session: AsyncSession, source: str, reason: str) -> None:
    row = await _health(session, source)
    row.configured = False
    row.last_error = reason
