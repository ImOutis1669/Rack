"""The feed's Refresh button: ask the worker to search the sources for you now.

Each person has their own request, cooldown and results (user state "refresh"); the worker runs
one refresh at a time, searching only the asker's own taste (worker/main.py run_user_refresh)."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import User, require_user
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.store import get_user_state, set_user_state

router = APIRouter(prefix="/api", tags=["refresh"], dependencies=[Depends(require_user)])


class RefreshOut(BaseModel):
    running: bool
    queued: bool
    started_at: datetime | None  # when your latest refresh started (the feed's "new for you")
    last_at: datetime | None
    next_allowed_at: datetime | None
    results: dict[str, int]
    message: str


def _dt(v: object) -> datetime | None:
    return datetime.fromisoformat(str(v)) if v else None


def cooldown(settings: Settings, role: str) -> timedelta:
    minutes = (
        settings.rack_manual_refresh_cooldown_minutes
        if role == "owner"
        else settings.rack_friend_refresh_cooldown_minutes
    )
    return timedelta(minutes=minutes)


async def _status(
    session: AsyncSession, settings: Settings, user: User, message: str = ""
) -> RefreshOut:
    state = await get_user_state(session, user.id, "refresh")
    started, asked = _dt(state.get("started_at")), _dt(state.get("requested_at"))
    queued = bool(asked and (started is None or asked > started))
    next_allowed = started + cooldown(settings, user.role) if started else None
    if next_allowed and next_allowed <= datetime.now(UTC):
        next_allowed = None
    return RefreshOut(
        running=bool(state.get("running")),
        queued=queued,
        started_at=started,
        last_at=_dt(state.get("at")),
        next_allowed_at=next_allowed,
        results={k: int(v) for k, v in (state.get("results") or {}).items()},
        message=message,
    )


@router.get("/refresh", response_model=RefreshOut)
async def refresh_status(
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    user: User,
) -> RefreshOut:
    return await _status(session, settings, user)


@router.post("/refresh", response_model=RefreshOut)
async def request_refresh(
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    user: User,
) -> RefreshOut:
    status = await _status(session, settings, user)
    if status.running or status.queued:
        return status.model_copy(update={"message": "Already searching for you."})
    if status.next_allowed_at:
        mins = max(1, round((status.next_allowed_at - datetime.now(UTC)).total_seconds() / 60))
        return status.model_copy(
            update={"message": f"You searched moments ago; try again in ~{mins} min."}
        )
    state = await get_user_state(session, user.id, "refresh")
    now = datetime.now(UTC).isoformat()
    await set_user_state(session, user.id, "refresh", {**state, "requested_at": now})
    await session.commit()
    return await _status(session, settings, user, "Searching your designers now.")
