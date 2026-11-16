"""Saved hunts: search on each hunt's own schedule and push new matches."""

import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import record_error, record_success, upsert_listings
from rack.models import (
    HiddenRow,
    HuntMatchRow,
    HuntRow,
    ListingRow,
    ListingScoreRow,
    TasteItemRow,
)
from rack.notify.base import Channel, Notification
from rack.notify.dispatch import notify_once
from rack.parsing.categories import infer_category
from rack.parsing.measurements import parse_measurements
from rack.ranking.brands import match_designer
from rack.ranking.brands import normalize as normalize_name
from rack.ranking.filters import Hidden, hard_filter
from rack.ranking.hunt_match import HuntSpec, hunt_matches
from rack.sources.base import Category, SearchQuery, SourceAdapter, SourceError, SourceNotConfigured
from rack.store import load_designers, load_profile

log = logging.getLogger(__name__)
FREE_SOURCES = ("ebay", "vinted", "grailed")
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


async def run_hunt(
    session: AsyncSession,
    hunt: HuntRow,
    adapters: Mapping[str, SourceAdapter],
    channels: Sequence[Channel],
) -> int:
    """Search, store, match and notify. Returns the number of new matches."""
    spec = HuntSpec(
        query=hunt.query,
        category=Category(hunt.category),
        max_price_gbp=float(hunt.max_price_gbp) if hunt.max_price_gbp is not None else None,
        sizes=list(hunt.sizes or []),
        min_score=hunt.min_score,
    )
    q = SearchQuery(
        text=hunt.query, category=spec.category, max_price_gbp=hunt.max_price_gbp, limit=50
    )
    first_run = hunt.last_run_at is None
    errors: list[str] = []
    ids: list[int] = []
    for name in hunt.sources or FREE_SOURCES:
        adapter = adapters.get(name)
        if adapter is None:
            continue
        try:
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

    profile, _ = await load_profile(session)
    designers = await load_designers(session)
    hidden = Hidden()
    for h in (await session.execute(select(HiddenRow))).scalars():
        (hidden.sellers if h.kind == "seller" else hidden.brands).add(normalize_name(h.value))
    scores = {
        s.listing_id: s.score
        for s in (
            await session.execute(
                select(ListingScoreRow).where(ListingScoreRow.listing_id.in_(ids))
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
                    ~exists().where(TasteItemRow.listing_id == ListingRow.id),
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
                key=f"hunt:{hunt.id}:{row.source}:{row.source_id}",
                kind="hunt",
                n=match_notification(hunt, row),
                listing_id=row.id,
            )
    log.info("hunt %r: %d new matches%s", hunt.name, len(new), " (baseline)" if first_run else "")
    return len(new)


async def run_due_hunts(
    sessions: async_sessionmaker[AsyncSession],
    adapters: Mapping[str, SourceAdapter],
    channels: Sequence[Channel],
) -> int:
    now = datetime.now(UTC)
    async with sessions() as s:
        hunts = (
            (
                await s.execute(
                    select(HuntRow).where(
                        or_(HuntRow.enabled.is_(True), HuntRow.run_requested_at.is_not(None))
                    )
                )
            )
            .scalars()
            .all()
        )
        total = 0
        for hunt in hunts:
            if due(hunt, now):
                total += await run_hunt(s, hunt, adapters, channels)
        return total
