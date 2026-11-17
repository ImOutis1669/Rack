"""Keep wardrobe resale estimates fresh (5b): new photos/brands right away, the rest every 6 h."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import TasteItemRow
from rack.pricing.resale import estimate_item
from rack.store import load_designers

log = logging.getLogger(__name__)
REFRESH_AFTER = timedelta(hours=6)


async def refresh_estimates(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """Re-estimates wardrobe items that are due. Returns how many were estimated."""
    async with sessions() as s:
        designers: dict[int, list[str]] = {}
        due = (
            (
                await s.execute(
                    select(TasteItemRow).where(
                        TasteItemRow.kind == "wardrobe",
                        TasteItemRow.embedding.is_not(None),
                        or_(
                            TasteItemRow.estimate_at.is_(None),
                            TasteItemRow.estimate_at < now - REFRESH_AFTER,
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        for item in due:
            if item.user_id not in designers:  # an item's brand is read with its owner's designers
                designers[item.user_id] = list(await load_designers(s, item.user_id))
            await estimate_item(s, item, designers[item.user_id], now)
        await s.commit()
    return len(due)
