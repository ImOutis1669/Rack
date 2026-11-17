"""Saved hunts: CRUD, run-now and their matches."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import CurrentUser, User, require_session
from rack.api.feed import hydrate
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.models import HuntMatchRow, HuntRow, ListingRow
from rack.schemas import ListingOut
from rack.sources.base import Category
from rack.sources.registry import SOURCE_NAMES
from rack.store import get_owned
from rack.worker.hunts import MIN_INTERVAL_MINUTES, prune_matches

router = APIRouter(prefix="/api/hunts", tags=["hunts"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]
SourceName = Literal["ebay", "vinted", "grailed"]


class HuntIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    query: str = Field(min_length=2, max_length=300)
    category: Category = Category.ANY
    max_price_gbp: Decimal | None = Field(default=None, ge=0)
    sizes: list[str] = Field(default_factory=list, max_length=20)
    strict_size: bool = False  # "Size must match"; needs at least one size
    sources: list[SourceName] = Field(default_factory=list)  # empty = all free sources
    min_score: float | None = Field(default=None, ge=0, le=1.5)
    interval_minutes: int = Field(default=30, ge=MIN_INTERVAL_MINUTES, le=24 * 60)
    enabled: bool = True
    notify: bool = True


class HuntOut(HuntIn):
    id: int
    last_run_at: datetime | None
    run_requested_at: datetime | None
    last_error: str | None
    match_count: int
    new_count: int  # matches found after the first (baseline) run


def _out(h: HuntRow, counts: dict[int, tuple[int, int]]) -> HuntOut:
    total, new = counts.get(h.id, (0, 0))
    return HuntOut(
        id=h.id,
        name=h.name,
        query=h.query,
        category=Category(h.category),
        max_price_gbp=h.max_price_gbp,
        sizes=list(h.sizes or []),
        strict_size=h.strict_size,
        sources=[s for s in (h.sources or []) if s in SOURCE_NAMES],
        min_score=h.min_score,
        interval_minutes=h.interval_minutes,
        enabled=h.enabled,
        notify=h.notify,
        last_run_at=h.last_run_at,
        run_requested_at=h.run_requested_at,
        last_error=h.last_error,
        match_count=total,
        new_count=new,
    )


async def _counts(session: AsyncSession, user_id: int) -> dict[int, tuple[int, int]]:
    rows = await session.execute(
        select(
            HuntMatchRow.hunt_id,
            func.count(),
            func.count().filter(HuntMatchRow.baseline.is_(False)),
        )
        .join(HuntRow, HuntRow.id == HuntMatchRow.hunt_id)
        .where(HuntRow.user_id == user_id)
        .group_by(HuntMatchRow.hunt_id)
    )
    return {hid: (int(total), int(new)) for hid, total, new in rows.all()}


async def _get(session: AsyncSession, hunt_id: int, user_id: int) -> HuntRow:
    return await get_owned(session, HuntRow, hunt_id, user_id)


def _check_caps(body: HuntIn, user: CurrentUser, settings: Settings) -> None:
    """Friends share the owner's eBay quota and the marketplaces' patience: slower hunts."""
    if not user.is_owner and body.interval_minutes < settings.rack_friend_min_hunt_minutes:
        raise HTTPException(
            400, f"Hunts run every {settings.rack_friend_min_hunt_minutes} minutes at most"
        )


def _apply(hunt: HuntRow, body: HuntIn) -> None:
    hunt.name = body.name.strip()
    hunt.query = " ".join(body.query.split())
    hunt.category = body.category.value
    hunt.max_price_gbp = body.max_price_gbp
    hunt.sizes = [s.strip() for s in body.sizes if s.strip()]
    hunt.strict_size = body.strict_size and bool(hunt.sizes)  # nothing to match without sizes
    hunt.sources = list(dict.fromkeys(body.sources))
    hunt.min_score = body.min_score
    hunt.interval_minutes = body.interval_minutes
    hunt.enabled = body.enabled
    hunt.notify = body.notify


@router.get("", response_model=list[HuntOut])
async def list_hunts(session: Session, user: User) -> list[HuntOut]:
    hunts = (
        await session.execute(
            select(HuntRow).where(HuntRow.user_id == user.id).order_by(HuntRow.created_at.desc())
        )
    ).scalars()
    counts = await _counts(session, user.id)
    return [_out(h, counts) for h in hunts]


@router.post("", response_model=HuntOut)
async def create_hunt(
    body: HuntIn,
    session: Session,
    user: User,
    settings: Annotated[Settings, Depends(get_settings)],
) -> HuntOut:
    _check_caps(body, user, settings)
    if not user.is_owner:
        have = await session.scalar(
            select(func.count(HuntRow.id)).where(HuntRow.user_id == user.id)
        )
        if (have or 0) >= settings.rack_friend_max_hunts:
            raise HTTPException(400, f"You can have {settings.rack_friend_max_hunts} hunts")
    hunt = HuntRow(user_id=user.id)
    _apply(hunt, body)
    session.add(hunt)
    await session.commit()
    return _out(hunt, {})


@router.put("/{hunt_id}", response_model=HuntOut)
async def update_hunt(
    hunt_id: int,
    body: HuntIn,
    session: Session,
    user: User,
    settings: Annotated[Settings, Depends(get_settings)],
) -> HuntOut:
    hunt = await _get(session, hunt_id, user.id)
    _check_caps(body, user, settings)
    changed_search = (hunt.query, hunt.category) != (
        " ".join(body.query.split()),
        body.category.value,
    )
    _apply(hunt, body)
    if changed_search:
        hunt.last_run_at = None  # new search: next run is a fresh baseline, no alert storm
    await prune_matches(session, hunt)  # matches that the new settings exclude go now
    await session.commit()
    return _out(hunt, await _counts(session, user.id))


@router.delete("/{hunt_id}", status_code=204)
async def delete_hunt(hunt_id: int, session: Session, user: User) -> None:
    await session.delete(await _get(session, hunt_id, user.id))
    await session.commit()


@router.post("/{hunt_id}/run", response_model=HuntOut)
async def run_now(
    hunt_id: int, session: Session, user: User, settings: Annotated[Settings, Depends(get_settings)]
) -> HuntOut:
    """Ask the worker to run this hunt within the next minute (friends: at most once per their
    minimum interval, so "run now" can't get round the cap)."""
    hunt = await _get(session, hunt_id, user.id)
    now = datetime.now(UTC)
    if not user.is_owner and hunt.last_run_at is not None:
        wait = timedelta(minutes=settings.rack_friend_min_hunt_minutes)
        if hunt.last_run_at + wait > now:
            raise HTTPException(429, "This hunt ran recently; try again later")
    hunt.run_requested_at = now
    await session.commit()
    return _out(hunt, await _counts(session, user.id))


@router.get("/{hunt_id}/matches", response_model=list[ListingOut])
async def matches(hunt_id: int, session: Session, user: User) -> list[ListingOut]:
    await _get(session, hunt_id, user.id)
    rows = (
        (
            await session.execute(
                select(ListingRow)
                .join(HuntMatchRow, HuntMatchRow.listing_id == ListingRow.id)
                .where(HuntMatchRow.hunt_id == hunt_id)
                .order_by(HuntMatchRow.matched_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    return await hydrate(session, rows, user.id)
