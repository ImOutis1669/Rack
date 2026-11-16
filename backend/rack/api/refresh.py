"""The feed's Refresh button: ask the worker to search the sources now (with a cooldown)."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.store import get_state, set_state

router = APIRouter(prefix="/api", tags=["refresh"], dependencies=[Depends(require_session)])


class RefreshOut(BaseModel):
    running: bool
    queued: bool
    last_at: datetime | None
    next_allowed_at: datetime | None
    results: dict[str, int]
    message: str


def _dt(v: object) -> datetime | None:
    return datetime.fromisoformat(str(v)) if v else None


async def _status(session: AsyncSession, settings: Settings, message: str = "") -> RefreshOut:
    done = await get_state(session, "refresh")
    req = await get_state(session, "refresh_request")
    started, asked = _dt(done.get("started_at")), _dt(req.get("at"))
    queued = bool(asked and (started is None or asked > started))
    cooldown = timedelta(minutes=settings.rack_manual_refresh_cooldown_minutes)
    next_allowed = started + cooldown if started else None
    if next_allowed and next_allowed <= datetime.now(UTC):
        next_allowed = None
    return RefreshOut(
        running=bool(done.get("running")),
        queued=queued,
        last_at=_dt(done.get("at")),
        next_allowed_at=next_allowed,
        results={k: int(v) for k, v in (done.get("results") or {}).items()},
        message=message,
    )


@router.get("/refresh", response_model=RefreshOut)
async def refresh_status(
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RefreshOut:
    return await _status(session, settings)


@router.post("/refresh", response_model=RefreshOut)
async def request_refresh(
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RefreshOut:
    status = await _status(session, settings)
    if status.running or status.queued:
        return status.model_copy(update={"message": "Already searching the sources."})
    if status.next_allowed_at:
        mins = max(1, round((status.next_allowed_at - datetime.now(UTC)).total_seconds() / 60))
        return status.model_copy(
            update={"message": f"Sources were searched moments ago; try again in ~{mins} min."}
        )
    await set_state(session, "refresh_request", {"at": datetime.now(UTC).isoformat()})
    await session.commit()
    return await _status(session, settings, "Searching the sources now.")
