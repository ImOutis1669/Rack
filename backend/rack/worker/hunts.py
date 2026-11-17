"""Saved hunts: search on each hunt's own schedule and push new matches."""

import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings
from rack.ingest import record_error, record_success, upsert_listings
from rack.models import (
    HiddenRow,
    HuntMatchRow,
    HuntRow,
    ListingRow,
    ListingScoreRow,
    TasteItemRow,
    UserRow,
)
from rack.notify.base import Channel, Notification
from rack.notify.dispatch import build_channels, notify_once
from rack.parsing.categories import infer_category
from rack.parsing.measurements import parse_measurements
from rack.ranking.brands import match_designer
from rack.ranking.brands import normalize as normalize_name
from rack.ranking.filters import Hidden, hard_filter
from rack.ranking.hunt_match import HuntSpec, hunt_matches
from rack.sources.base import Category, SearchQuery, SourceAdapter, SourceError, SourceNotConfigured
from rack.sources.ebay import quota_day
from rack.sources.registry import SOURCE_NAMES
from rack.store import get_user_state, load_designers, load_profile, set_user_state

log = logging.getLogger(__name__)
MIN_INTERVAL_MINUTES = 5


def _fmt_gbp(v: Decimal | None) -> str:
    return f"£{v:,.0f}" if v is not None else "price n/a"


def match_notification(hunt: HuntRow, row: ListingRow) -> Notification:
    bits = [_fmt_gbp(row.price_gbp), row.size and f"size {row.size}", row.condition, row.source]
    return Notification(
        title=f"{hunt.name}: {row.title}"[:250],
        body=" · ".join(str(b) for b in bits if b),
        url=row.url,
        image_url=row.images[0].url if row.images else None,
        tags=["mag"],
        priority=4,
    )


def due(hunt: HuntRow, now: datetime) -> bool:
    if hunt.run_requested_at is not None:
        return True
    if not hunt.enabled:
        return False
    if hunt.last_run_at is None:
        return True
    every = timedelta(minutes=max(MIN_INTERVAL_MINUTES, hunt.interval_minutes))
    return hunt.last_run_at + every <= now


def spec_for(hunt: HuntRow) -> HuntSpec:
    return HuntSpec(
        query=hunt.query,
        category=Category(hunt.category),
        max_price_gbp=float(hunt.max_price_gbp) if hunt.max_price_gbp is not None else None,
        sizes=list(hunt.sizes or []),
        strict_size=hunt.strict_size,
        min_score=hunt.min_score,
    )


async def prune_matches(session: AsyncSession, hunt: HuntRow) -> int:
    """Delete this hunt's stored matches that its current settings would no longer match.

    Matches used to be add-only, so editing a hunt (e.g. turning on "Size must match", or a
    lower max price) left every earlier match listed (bug found in iOS step 6). Re-checked with
    the listing's current data, so a size learned later counts too. Doesn't commit.
    """
    spec = spec_for(hunt)
    rows = (
        await session.execute(
            select(HuntMatchRow.id, ListingRow)
            .join(ListingRow, ListingRow.id == HuntMatchRow.listing_id)
            .where(HuntMatchRow.hunt_id == hunt.id)
        )
    ).all()
    if not rows:
        return 0
    scores = {
        s.listing_id: s.score
        for s in (
            await session.execute(
                select(ListingScoreRow).where(
                    ListingScoreRow.user_id == hunt.user_id,
                    ListingScoreRow.listing_id.in_([r.id for _, r in rows]),
                )
            )
        ).scalars()
    }
    stale = [
        match_id
        for match_id, row in rows
        if not hunt_matches(
            spec,
            title=row.title,
            brand=row.brand,
            description=row.description,
            price_gbp=float(row.price_gbp) if row.price_gbp is not None else None,
            size=row.size,
            score=scores.get(row.id),
        )
    ]
    if stale:
        await session.execute(delete(HuntMatchRow).where(HuntMatchRow.id.in_(stale)))
        log.info("hunt %s: %d stored matches no longer fit its settings", hunt.id, len(stale))
    return len(stale)


async def run_hunt(
    session: AsyncSession,
    hunt: HuntRow,
    adapters: Mapping[str, SourceAdapter],
    channels: Sequence[Channel],
) -> int:
    """Search, store, match and notify. Returns the number of new matches."""
    spec = spec_for(hunt)
    # matches stored under older settings (or before a listing's size was known) that no
    # longer fit leave first, so the list always reflects the hunt as it is now
    await prune_matches(session, hunt)
    q = SearchQuery(
        text=hunt.query, category=spec.category, max_price_gbp=hunt.max_price_gbp, limit=50
    )
    first_run = hunt.last_run_at is None
    errors: list[str] = []
    ids: list[int] = []
    for name in hunt.sources or SOURCE_NAMES:
        adapter = adapters.get(name)
        if adapter is None:
            continue
        try:
            if name == "ebay":
                await count_ebay_search(session, hunt.user_id)
            listings = await adapter.search(q)
        except SourceNotConfigured:
            continue
        except SourceError as exc:
            errors.append(f"{name}: {exc}")
            await session.rollback()
            await record_error(session, name, f"{type(exc).__name__}: {exc}")
            await session.commit()
            continue
        ids += await upsert_listings(session, listings)
        await record_success(session, name, len(listings))
        await session.commit()

    uid = hunt.user_id
    profile, _ = await load_profile(session, uid)
    designers = await load_designers(session, uid)
    hidden = Hidden()
    for h in (await session.execute(select(HiddenRow).where(HiddenRow.user_id == uid))).scalars():
        (hidden.sellers if h.kind == "seller" else hidden.brands).add(normalize_name(h.value))
    scores = {
        s.listing_id: s.score
        for s in (
            await session.execute(
                select(ListingScoreRow).where(
                    ListingScoreRow.user_id == uid, ListingScoreRow.listing_id.in_(ids)
                )
            )
        ).scalars()
    }
    already = set(
        (
            await session.execute(
                select(HuntMatchRow.listing_id).where(HuntMatchRow.hunt_id == hunt.id)
            )
        ).scalars()
    )
    rows = (
        (
            await session.execute(
                select(ListingRow).where(
                    ListingRow.id.in_(ids),
                    ListingRow.active,
                    # already bought ("I bought it"): never alert on it again
                    ~exists().where(
                        TasteItemRow.user_id == uid, TasteItemRow.listing_id == ListingRow.id
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    new: list[ListingRow] = []
    for row in rows:
        if row.id in already:
            continue
        price = float(row.price_gbp) if row.price_gbp is not None else None
        if not hunt_matches(
            spec,
            title=row.title,
            brand=row.brand,
            description=row.description,
            price_gbp=price,
            size=row.size,
            score=scores.get(row.id),
        ):
            continue
        designer = match_designer(row.brand, row.title, list(designers))
        # your global rules (hidden sellers/brands, banned words, fit, exclusions) still apply
        if hard_filter(
            title=row.title,
            description=row.description,
            brand=row.brand,
            seller=row.seller_name,
            price_gbp=price,
            size=row.size,
            category=infer_category(row.title),
            designer=designer,
            designer_weight=designers.get(designer) if designer else None,
            measurements=parse_measurements(f"{row.title}\n{row.description or ''}"),
            profile=profile,
            hidden=hidden,
        ):
            continue
        new.append(row)

    for row in new:
        await session.execute(
            insert(HuntMatchRow)
            .values(hunt_id=hunt.id, listing_id=row.id, baseline=first_run)
            .on_conflict_do_nothing()
        )
    hunt.last_run_at = datetime.now(UTC)
    hunt.run_requested_at = None
    hunt.last_error = "; ".join(errors)[:1000] or None
    await session.commit()

    if hunt.notify and not first_run:
        for row in new:
            await notify_once(
                session,
                channels,
                user_id=uid,
                key=f"hunt:{hunt.id}:{row.source}:{row.source_id}",
                kind="hunt",
                n=match_notification(hunt, row),
                listing_id=row.id,
            )
    log.info("hunt %r: %d new matches%s", hunt.name, len(new), " (baseline)" if first_run else "")
    return len(new)


async def count_ebay_search(session: AsyncSession, user_id: int) -> None:
    """eBay searches per user per eBay day, for the owner's admin view (quota is shared)."""
    today = quota_day()
    st = await get_user_state(session, user_id, "ebay_usage")
    n = int(st.get("search", 0)) if st.get("day") == today else 0
    await set_user_state(session, user_id, "ebay_usage", {"day": today, "search": n + 1})


async def run_due_hunts(
    sessions: async_sessionmaker[AsyncSession],
    adapters: Mapping[str, SourceAdapter],
    settings: Settings,
    channels_override: Sequence[Channel] | None = None,  # tests: the same channels for everyone
) -> int:
    """Due hunts of enabled accounts, each alerting its own user's channels."""
    now = datetime.now(UTC)
    async with sessions() as s:
        hunts = (
            await s.execute(
                select(HuntRow, UserRow.role)
                .join(UserRow, UserRow.id == HuntRow.user_id)
                .where(
                    UserRow.disabled_at.is_(None),
                    or_(HuntRow.enabled.is_(True), HuntRow.run_requested_at.is_not(None)),
                )
                .order_by(HuntRow.id)
            )
        ).all()
        channels: dict[int, list[Channel]] = {}
        total = 0
        for hunt, role in hunts:
            if not due(hunt, now):
                continue
            if hunt.user_id not in channels:
                channels[hunt.user_id] = (
                    list(channels_override)
                    if channels_override is not None
                    else build_channels(
                        settings, sessions, user_id=hunt.user_id, owner=role == "owner"
                    )
                )
            total += await run_hunt(s, hunt, adapters, channels[hunt.user_id])
        return total
