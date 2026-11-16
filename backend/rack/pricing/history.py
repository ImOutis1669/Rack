"""Price history: one observation per price change."""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import PriceObservationRow


async def record_price(session: AsyncSession, listing_id: int, price_gbp: Decimal | None) -> bool:
    """Append an observation if the price differs from the last one. Returns True if recorded."""
    if price_gbp is None:
        return False
    last = (
        await session.execute(
            select(PriceObservationRow.price_gbp)
            .where(PriceObservationRow.listing_id == listing_id)
            .order_by(PriceObservationRow.observed_at.desc(), PriceObservationRow.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last is not None and Decimal(last) == Decimal(price_gbp):
        return False
    session.add(PriceObservationRow(listing_id=listing_id, price_gbp=price_gbp))
    return True


async def first_prices(
    session: AsyncSession, listing_ids: list[int] | None = None
) -> dict[int, Decimal]:
    """Price when first seen, per listing (all listings if `listing_ids` is None)."""
    stmt = select(PriceObservationRow.listing_id, PriceObservationRow.price_gbp).order_by(
        PriceObservationRow.listing_id, PriceObservationRow.observed_at, PriceObservationRow.id
    )
    if listing_ids is not None:
        if not listing_ids:
            return {}
        stmt = stmt.where(PriceObservationRow.listing_id.in_(listing_ids))
    out: dict[int, Decimal] = {}
    for lid, price in (await session.execute(stmt)).all():
        out.setdefault(lid, price)
    return out


def price_cut(first: Decimal | None, now: Decimal | None, min_pct: float = 5.0) -> Decimal | None:
    """The original price if it has since been cut by at least `min_pct`%, else None."""
    if first is None or now is None or first <= 0:
        return None
    return first if (first - now) / first * 100 >= Decimal(str(min_pct)) else None
