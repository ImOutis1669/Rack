"""Price-drop alerts for saved items."""

import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings
from rack.models import ListingRow, SavedRow
from rack.notify.base import Channel, Notification
from rack.notify.dispatch import notify_once
from rack.sources.base import SourceAdapter, SourceError, SourceNotConfigured
from rack.sources.vinted import VintedAdapter

log = logging.getLogger(__name__)


def is_drop(ref: Decimal | None, now: Decimal | None, min_pct: float, min_gbp: float) -> bool:
    if ref is None or now is None or ref <= 0:
        return False
    fall = ref - now
    return fall >= Decimal(str(min_gbp)) and fall / ref * 100 >= Decimal(str(min_pct))


async def _refresh_price(row: ListingRow, adapter: SourceAdapter | None) -> bool:
    """Update the row's price/availability from the marketplace. False if we couldn't check."""
    if adapter is None:
        return False
    if isinstance(adapter, VintedAdapter):
        d = await adapter.item_details(row.url)
        if d.available is False:
            row.active = False
        elif d.price is not None and row.price:
            # keep Vinted's buyer-protection fee proportion: price_gbp is what you pay
            ratio = (row.price_gbp or row.price) / row.price
            row.price = d.price
            row.price_gbp = (d.price * ratio).quantize(Decimal("0.01"))
        return True
    fresh = await adapter.get_listing(row.url)
    if fresh is None:
        if row.source in ("grailed", "ebay"):  # these lookups say None for gone/sold
            row.active = False
            return True
        return False
    row.price, row.price_gbp = fresh.price, fresh.price_gbp
    return True


async def check_saved_prices(
    sessions: async_sessionmaker[AsyncSession],
    adapters: Mapping[str, SourceAdapter],
    channels: Sequence[Channel],
    settings: Settings,
) -> int:
    now = datetime.now(UTC)
    stale = now - timedelta(hours=settings.rack_price_check_hours)
    alerts = 0
    async with sessions() as s:
        pairs = (
            await s.execute(
                select(SavedRow, ListingRow)
                .join(ListingRow, ListingRow.id == SavedRow.listing_id)
                .where(ListingRow.active.is_(True))
            )
        ).all()
        for saved, row in pairs:
            if saved.price_checked_at and saved.price_checked_at > stale:
                continue
            # seen in a search since the last check: that price is fresh enough
            if row.last_seen_at <= stale:
                try:
                    if not await _refresh_price(row, adapters.get(row.source)):
                        continue
                except SourceNotConfigured:
                    continue
                except SourceError as exc:
                    log.info("price check %s failed: %s", row.url, exc)
                    continue
                row.last_seen_at = now
            saved.price_checked_at = now
            await s.commit()
            if not row.active:
                continue
            ref = saved.last_alert_price_gbp or saved.price_gbp_at_save
            if is_drop(
                ref,
                row.price_gbp,
                settings.rack_price_drop_min_pct,
                settings.rack_price_drop_min_gbp,
            ):
                sent = await notify_once(
                    s,
                    channels,
                    key=f"drop:{row.id}:{row.price_gbp}",
                    kind="price_drop",
                    n=Notification(
                        title=f"Price drop: {row.title}"[:250],
                        body=f"£{ref:,.0f} → £{row.price_gbp:,.0f} on {row.source}",
                        url=row.url,
                        image_url=row.images[0].url if row.images else None,
                        tags=["chart_with_downwards_trend"],
                        priority=4,
                    ),
                    listing_id=row.id,
                )
                if sent:
                    saved.last_alert_price_gbp = row.price_gbp
                    await s.commit()
                    alerts += 1
    return alerts
