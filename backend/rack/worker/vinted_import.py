"""Fetch queued Vinted likes one at a time and like them for their user (see api/imports.py).

One item per run, through the shared Vinted adapter, so imports go at Vinted's usual pace (one
request every RATE_VINTED seconds, shared with searches) and never faster. A listing Rack has
never seen is added from its item page (sold ones are kept, hidden from feeds, so they still
shape taste); the user then likes it. Gone items are counted, not retried. If Vinted turns
requests away, that user's import waits PAUSE and tries the same item again.
"""

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import FeedbackRow, ListingRow, UserRow, UserStateRow
from rack.pricing.fx import to_gbp
from rack.sources.base import Listing, SourceAdapter, SourceError, build_listing
from rack.sources.vinted import BASE, ItemDetails, VintedAdapter
from rack.store import bump_version, get_user_state, set_user_state

log = logging.getLogger(__name__)

STATE = "vinted_import"
PAUSE = timedelta(minutes=30)
RESCORE_EVERY = 25  # likes between rescores while importing (each rescore is a full pass)
# Vinted UK buyer protection, which every buyer pays: £0.70 + 5% of the item price. Search
# results give the total; an item page only the item price, so it's estimated here.
FEE_FIXED = Decimal("0.70")
FEE_RATE = Decimal("0.05")


def favourite_listing(item_id: str, title: str, d: ItemDetails) -> Listing | None:
    """A Listing from an item page, or None when it has no price (nothing to rank by)."""
    if d.price is None or not d.currency:
        return None
    total = d.price + FEE_FIXED + d.price * FEE_RATE if d.currency == "GBP" else d.price
    return build_listing(
        source="vinted",
        source_id=item_id,
        url=f"{BASE}/items/{item_id}",
        title=d.title or title,
        description=d.description,
        brand=d.brand,
        price=d.price,
        currency=d.currency,
        price_gbp=to_gbp(total.quantize(Decimal("0.01")), d.currency),
        images=d.images,
        country="GB",
        raw={"imported_from": "vinted_favourites"},
    )


def _refused(exc: SourceError) -> bool:
    text = str(exc)
    return "refused" in text or "HTTP 403" in text or "HTTP 429" in text


async def _next_user(s: AsyncSession, now: datetime) -> tuple[int, dict[str, Any]] | None:
    rows = (
        await s.execute(
            select(UserStateRow.user_id, UserStateRow.value)
            .join(UserRow, UserRow.id == UserStateRow.user_id)
            .where(UserStateRow.key == STATE, UserRow.disabled_at.is_(None))
            .order_by(UserStateRow.user_id)
        )
    ).all()
    for uid, state in rows:
        paused = state.get("paused_until")
        if state.get("queue") and not (paused and datetime.fromisoformat(paused) > now):
            return int(uid), dict(state)
    return None


async def run_vinted_imports(
    sessions: async_sessionmaker[AsyncSession],
    adapters: Mapping[str, SourceAdapter],
    now: datetime | None = None,
) -> bool:
    """Import one queued item. True if one was tried."""
    adapter = adapters.get("vinted")
    if not isinstance(adapter, VintedAdapter):
        return False
    now = now or datetime.now(UTC)
    async with sessions() as s:
        picked = await _next_user(s, now)
    if picked is None:
        return False
    uid, state = picked
    item_id, title = state["queue"][0]

    details: ItemDetails | None = None
    try:
        details = await adapter.item_details(f"{BASE}/items/{item_id}")
    except SourceError as exc:
        if _refused(exc):
            log.warning("vinted import for user %d paused: %s", uid, exc)
            async with sessions() as s:
                current = await get_user_state(s, uid, STATE)
                current["paused_until"] = (now + PAUSE).isoformat()
                current["error"] = "Vinted is turning requests away; trying again in 30 minutes"
                await set_user_state(s, uid, STATE, current)
                await s.commit()
            return True
        log.info("vinted import: item %s not added (%s)", item_id, exc)

    async with sessions() as s:
        current = await get_user_state(s, uid, STATE)
        queue = current.get("queue") or []
        if not queue or queue[0][0] != item_id:
            return True  # a new import replaced this one meanwhile
        listing = favourite_listing(item_id, title, details) if details else None
        if listing is None:
            current["missing"] = int(current.get("missing", 0)) + 1
        else:
            [listing_id] = await upsert_listings(s, [listing])
            if details is not None and details.available is False:
                await s.execute(
                    update(ListingRow).where(ListingRow.id == listing_id).values(active=False)
                )
            await s.execute(
                insert(FeedbackRow)
                .values(user_id=uid, listing_id=listing_id, value=1)
                .on_conflict_do_nothing(
                    index_elements=[FeedbackRow.user_id, FeedbackRow.listing_id]
                )
            )
            current["added"] = int(current.get("added", 0)) + 1
        current["queue"] = queue[1:]
        current["paused_until"] = None
        current["error"] = None
        done = int(current.get("added", 0)) + int(current.get("missing", 0))
        if not current["queue"]:
            current["finished_at"] = now.isoformat()
        if not current["queue"] or done % RESCORE_EVERY == 0:
            await bump_version(s, uid)
        await set_user_state(s, uid, STATE, current)
        await s.commit()
    return True
