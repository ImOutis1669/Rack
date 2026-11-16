"""Marketplace data we promised not to keep.

eBay: the user's Marketplace Account Deletion exemption says "I do not persist eBay data", so no
eBay user (seller/buyer) data is stored, and eBay listings are deleted once they are inactive or
haven't been seen for `RACK_EBAY_RETENTION_DAYS`. The adapter already drops seller data; `scrub`
is the second line of defence at the database boundary.
"""

from datetime import datetime, timedelta

from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import ListingRow

# Sources whose listings must never carry seller/buyer personal data.
NO_USER_DATA_SOURCES = frozenset({"ebay"})
USER_DATA_COLUMNS = ("seller_name", "seller_rating", "seller_count", "location")
# `raw` keys that can hold user data on any marketplace payload.
USER_DATA_RAW_KEYS = frozenset({"seller", "buyer", "user", "itemLocation", "seller_username"})


def scrub(values: dict[str, object]) -> dict[str, object]:
    """Row values with all user data removed when the source requires it."""
    if values.get("source") not in NO_USER_DATA_SOURCES:
        return values
    out = dict(values)
    for col in USER_DATA_COLUMNS:
        out[col] = None
    raw = out.get("raw")
    if isinstance(raw, dict):
        clean = {k: v for k, v in raw.items() if k not in USER_DATA_RAW_KEYS}
        loc = raw.get("itemLocation")
        if isinstance(loc, dict) and loc.get("country"):
            clean["itemLocation"] = {"country": loc["country"]}
        out["raw"] = clean
    return out


async def purge_ebay(session: AsyncSession, retention_days: float, now: datetime) -> int:
    """Delete eBay listings that are inactive or unseen for `retention_days`. Caller commits.

    Photos, scores, price history, votes and saves go with them (ON DELETE CASCADE).
    """
    cutoff = now - timedelta(days=retention_days)
    result = await session.execute(
        delete(ListingRow)
        .where(
            ListingRow.source == "ebay",
            or_(ListingRow.active.is_(False), ListingRow.last_seen_at < cutoff),
        )
        .returning(ListingRow.id)
    )
    return len(result.all())
