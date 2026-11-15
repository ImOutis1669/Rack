"""Persist normalised listings and record per-source health."""

import hashlib
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import ListingImageRow, ListingRow, SourceHealthRow, utcnow
from rack.pricing.fx import to_gbp
from rack.sources.base import Listing


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _row_values(listing: Listing) -> dict[str, object]:
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
        update_cols = {k: ins.excluded[k] for k in values if k not in ("source", "source_id")}
        upsert = ins.on_conflict_do_update(
            constraint="uq_listing_source", set_=update_cols
        ).returning(ListingRow.id)
        listing_id = (await session.execute(upsert)).scalar_one()
        ids.append(listing_id)

        existing = (
            (
                await session.execute(
                    select(ListingImageRow).where(ListingImageRow.listing_id == listing_id)
                )
            )
            .scalars()
            .all()
        )
        if [img.url for img in sorted(existing, key=lambda i: i.position)] != listing.images:
            for img in existing:
                await session.delete(img)
            for pos, url in enumerate(listing.images):
                session.add(
                    ListingImageRow(
                        listing_id=listing_id, position=pos, url=url, url_hash=url_hash(url)
                    )
                )
    await session.flush()
    return ids


async def _health(session: AsyncSession, source: str) -> SourceHealthRow:
    row = await session.get(SourceHealthRow, source)
    if row is None:
        row = SourceHealthRow(source=source, error_count=0, consecutive_errors=0)
        session.add(row)
    return row


async def record_success(session: AsyncSession, source: str, count: int) -> None:
    row = await _health(session, source)
    row.configured = True
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
