"""Per-listing actions (👍/👎, save), hidden sellers/brands, seen tracking and visits."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.api.feed import hydrate
from rack.db import get_session
from rack.models import FeedbackRow, HiddenRow, ListingRow, SavedRow, SeenRow
from rack.schemas import ListingOut, VisitOut
from rack.store import bump_version, get_state, set_state

router = APIRouter(prefix="/api", tags=["actions"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]
VISIT_GAP = timedelta(minutes=30)


class FeedbackIn(BaseModel):
    value: Literal[-1, 0, 1]


class HiddenIn(BaseModel):
    kind: Literal["seller", "brand"]
    value: str = Field(min_length=1, max_length=200)


class HiddenOut(HiddenIn):
    id: int


class SeenIn(BaseModel):
    ids: list[int] = Field(max_length=500)


async def _listing(session: AsyncSession, listing_id: int) -> ListingRow:
    row = await session.get(ListingRow, listing_id)
    if row is None:
        raise HTTPException(404)
    return row


@router.post("/listings/{listing_id}/feedback", status_code=204)
async def feedback(listing_id: int, body: FeedbackIn, session: Session) -> None:
    await _listing(session, listing_id)
    if body.value == 0:
        await session.execute(delete(FeedbackRow).where(FeedbackRow.listing_id == listing_id))
    else:
        ins = insert(FeedbackRow).values(listing_id=listing_id, value=body.value)
        await session.execute(
            ins.on_conflict_do_update(
                index_elements=[FeedbackRow.listing_id],
                set_={"value": body.value, "created_at": datetime.now(UTC)},
            )
        )
    await bump_version(session)
    await session.commit()


@router.put("/listings/{listing_id}/saved", status_code=204)
async def save(listing_id: int, session: Session) -> None:
    row = await _listing(session, listing_id)
    ins = insert(SavedRow).values(listing_id=listing_id, price_gbp_at_save=row.price_gbp)
    await session.execute(ins.on_conflict_do_nothing())
    await session.commit()


@router.delete("/listings/{listing_id}/saved", status_code=204)
async def unsave(listing_id: int, session: Session) -> None:
    await session.execute(delete(SavedRow).where(SavedRow.listing_id == listing_id))
    await session.commit()


@router.get("/saved", response_model=list[ListingOut])
async def saved(session: Session) -> list[ListingOut]:
    rows = (
        (
            await session.execute(
                select(ListingRow)
                .join(SavedRow, SavedRow.listing_id == ListingRow.id)
                .order_by(SavedRow.saved_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return await hydrate(session, rows)


@router.get("/hidden", response_model=list[HiddenOut])
async def list_hidden(session: Session) -> list[HiddenOut]:
    rows = (
        await session.execute(select(HiddenRow).order_by(HiddenRow.created_at.desc()))
    ).scalars()
    return [HiddenOut(id=r.id, kind=r.kind, value=r.value) for r in rows]


@router.post("/hidden", response_model=HiddenOut)
async def add_hidden(body: HiddenIn, session: Session) -> HiddenOut:
    value = body.value.strip()
    ins = insert(HiddenRow).values(kind=body.kind, value=value).on_conflict_do_nothing()
    await session.execute(ins)
    await bump_version(session)
    await session.commit()
    row = (
        await session.execute(
            select(HiddenRow).where(HiddenRow.kind == body.kind, HiddenRow.value == value)
        )
    ).scalar_one()
    return HiddenOut(id=row.id, kind=body.kind, value=row.value)


@router.delete("/hidden/{hidden_id}", status_code=204)
async def remove_hidden(hidden_id: int, session: Session) -> None:
    await session.execute(delete(HiddenRow).where(HiddenRow.id == hidden_id))
    await bump_version(session)
    await session.commit()


@router.post("/seen", status_code=204)
async def seen(body: SeenIn, session: Session) -> None:
    if not body.ids:
        return
    existing = set(
        (await session.execute(select(ListingRow.id).where(ListingRow.id.in_(body.ids)))).scalars()
    )
    if existing:
        ins = insert(SeenRow).values([{"listing_id": i} for i in existing])
        await session.execute(ins.on_conflict_do_nothing())
        await session.commit()


@router.post("/visit", response_model=VisitOut)
async def visit(session: Session) -> VisitOut:
    """A visit starts after 30 min of inactivity. The feed hides what you saw in earlier visits."""
    now = datetime.now(UTC)
    st = await get_state(session, "visit")
    touched = datetime.fromisoformat(st["touched"]) if "touched" in st else None
    if touched is None or now - touched > VISIT_GAP:
        st["last"] = st.get("current")
        st["current"] = now.isoformat()
    st["touched"] = now.isoformat()
    await set_state(session, "visit", st)
    await session.commit()
    return VisitOut(
        visit_start=datetime.fromisoformat(st["current"]),
        last_visit=datetime.fromisoformat(st["last"]) if st.get("last") else None,
    )
