"""Import your Vinted likes from Vinted's personal-data export (v2.1).

POST takes the export zip (or its favourite_items/index.html), reads only the liked items, likes
the ones Rack already has straight away and queues the rest in your user state; the worker
(`worker/vinted_import.py`) fetches each queued item at Vinted's usual pace and likes it.
"""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import User, require_user
from rack.db import get_session
from rack.models import FeedbackRow, ListingRow
from rack.store import bump_version, get_user_state, set_user_state
from rack.vinted_export import ExportError, read_export

router = APIRouter(prefix="/api/import", tags=["import"], dependencies=[Depends(require_user)])
Session = Annotated[AsyncSession, Depends(get_session)]

STATE = "vinted_import"
MAX_UPLOAD = 400 * 1024 * 1024  # the whole export with its photos and PDFs (~110 MB for one user)


class ImportOut(BaseModel):
    running: bool
    total: int  # liked items in the export
    queued: int  # still to fetch
    added: int  # fetched from Vinted and liked
    already: int  # already in Rack: liked at once
    skipped: int  # you'd already voted on it in Rack (your vote stays)
    missing: int  # Vinted no longer has it, or it couldn't be read
    started_at: datetime | None
    finished_at: datetime | None
    paused_until: datetime | None  # Vinted turned requests away: trying again later
    error: str | None


def _dt(v: object) -> datetime | None:
    return datetime.fromisoformat(str(v)) if v else None


def status_out(state: dict[str, Any]) -> ImportOut:
    queue = state.get("queue") or []
    return ImportOut(
        running=bool(queue),
        total=int(state.get("total", 0)),
        queued=len(queue),
        added=int(state.get("added", 0)),
        already=int(state.get("already", 0)),
        skipped=int(state.get("skipped", 0)),
        missing=int(state.get("missing", 0)),
        started_at=_dt(state.get("started_at")),
        finished_at=_dt(state.get("finished_at")),
        paused_until=_dt(state.get("paused_until")),
        error=state.get("error"),
    )


@router.get("/vinted", response_model=ImportOut)
async def vinted_status(session: Session, user: User) -> ImportOut:
    return status_out(await get_user_state(session, user.id, STATE))


@router.post("/vinted", response_model=ImportOut)
async def import_vinted(
    session: Session, user: User, file: Annotated[UploadFile, File()]
) -> ImportOut:
    state = await get_user_state(session, user.id, STATE)
    if state.get("queue"):
        raise HTTPException(409, "An import is already running")
    if file.size is not None and file.size > MAX_UPLOAD:
        raise HTTPException(413, "That file is too large for a Vinted export")
    try:
        favourites = read_export(file.file, file.filename or "")
    except ExportError as exc:
        raise HTTPException(400, str(exc)) from exc

    ids = [f.item_id for f in favourites]
    known = dict(
        (
            await session.execute(
                select(ListingRow.source_id, ListingRow.id).where(
                    ListingRow.source == "vinted", ListingRow.source_id.in_(ids)
                )
            )
        ).all()
    )
    voted = set(
        (
            await session.execute(
                select(FeedbackRow.listing_id).where(
                    FeedbackRow.user_id == user.id, FeedbackRow.listing_id.in_(known.values())
                )
            )
        ).scalars()
    )
    already = skipped = 0
    queue: list[list[str]] = []
    for fav in favourites:
        listing_id = known.get(fav.item_id)
        if listing_id is None:
            queue.append([fav.item_id, fav.title])
        elif listing_id in voted:
            skipped += 1  # your vote in Rack (maybe a 👎 since) wins
        else:
            await session.execute(
                insert(FeedbackRow)
                .values(user_id=user.id, listing_id=listing_id, value=1)
                .on_conflict_do_nothing(
                    index_elements=[FeedbackRow.user_id, FeedbackRow.listing_id]
                )
            )
            already += 1
    now = datetime.now(UTC).isoformat()
    await set_user_state(
        session,
        user.id,
        STATE,
        {
            "queue": queue,
            "total": len(favourites),
            "added": 0,
            "already": already,
            "skipped": skipped,
            "missing": 0,
            "started_at": now,
            "finished_at": None if queue else now,
        },
    )
    if already:
        await bump_version(session, user.id)  # likes train the feed: rescore now
    await session.commit()
    return status_out(await get_user_state(session, user.id, STATE))
