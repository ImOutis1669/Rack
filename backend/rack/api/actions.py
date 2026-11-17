"""Per-listing actions (upvote/downvote, save), hidden sellers/brands, seen tracking and visits."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import User, require_session
from rack.api.feed import hydrate
from rack.db import get_session
from rack.models import FeedbackRow, HiddenRow, ListingRow, SavedRow, SeenRow
from rack.schemas import ListingOut, VisitOut
from rack.store import bump_version, get_user_state, set_user_state

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
async def feedback(listing_id: int, body: FeedbackIn, session: Session, user: User) -> None:
    await _listing(session, listing_id)
    if body.value == 0:
        await session.execute(
            delete(FeedbackRow).where(
                FeedbackRow.user_id == user.id, FeedbackRow.listing_id == listing_id
            )
        )
    else:
        ins = insert(FeedbackRow).values(user_id=user.id, listing_id=listing_id, value=body.value)
        await session.execute(
            ins.on_conflict_do_update(
                index_elements=[FeedbackRow.user_id, FeedbackRow.listing_id],
                set_={"value": body.value, "created_at": datetime.now(UTC)},
            )
        )
    await bump_version(session, user.id)
    await session.commit()


@router.put("/listings/{listing_id}/saved", status_code=204)
async def save(listing_id: int, session: Session, user: User) -> None:
    row = await _listing(session, listing_id)
    ins = insert(SavedRow).values(
        user_id=user.id, listing_id=listing_id, price_gbp_at_save=row.price_gbp
    )
    await session.execute(ins.on_conflict_do_nothing())
    await bump_version(session, user.id)  # saves train the preference vector, so rescore
    await session.commit()


@router.delete("/listings/{listing_id}/saved", status_code=204)
async def unsave(listing_id: int, session: Session, user: User) -> None:
    await session.execute(
        delete(SavedRow).where(SavedRow.user_id == user.id, SavedRow.listing_id == listing_id)
    )
    await bump_version(session, user.id)
    await session.commit()


@router.get("/saved", response_model=list[ListingOut])
async def saved(session: Session, user: User) -> list[ListingOut]:
    rows = (
        (
            await session.execute(
                select(ListingRow)
                .join(SavedRow, SavedRow.listing_id == ListingRow.id)
                .where(SavedRow.user_id == user.id)
                .order_by(SavedRow.saved_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return await hydrate(session, rows, user.id)


@router.get("/hidden", response_model=list[HiddenOut])
async def list_hidden(session: Session, user: User) -> list[HiddenOut]:
    rows = (
        await session.execute(
            select(HiddenRow)
            .where(HiddenRow.user_id == user.id)
            .order_by(HiddenRow.created_at.desc())
        )
    ).scalars()
    return [HiddenOut(id=r.id, kind=r.kind, value=r.value) for r in rows]


@router.post("/hidden", response_model=HiddenOut)
async def add_hidden(body: HiddenIn, session: Session, user: User) -> HiddenOut:
    value = body.value.strip()
    ins = (
        insert(HiddenRow)
        .values(user_id=user.id, kind=body.kind, value=value)
        .on_conflict_do_nothing()
    )
    await session.execute(ins)
    await bump_version(session, user.id)
    await session.commit()
    row = (
        await session.execute(
            select(HiddenRow).where(
                HiddenRow.user_id == user.id, HiddenRow.kind == body.kind, HiddenRow.value == value
            )
        )
    ).scalar_one()
    return HiddenOut(id=row.id, kind=body.kind, value=row.value)


@router.delete("/hidden/{hidden_id}", status_code=204)
async def remove_hidden(hidden_id: int, session: Session, user: User) -> None:
    await session.execute(
        delete(HiddenRow).where(HiddenRow.id == hidden_id, HiddenRow.user_id == user.id)
    )
    await bump_version(session, user.id)
    await session.commit()


@router.post("/seen", status_code=204)
async def seen(body: SeenIn, session: Session, user: User) -> None:
    if not body.ids:
        return
    existing = set(
        (await session.execute(select(ListingRow.id).where(ListingRow.id.in_(body.ids)))).scalars()
    )
    if existing:
        ins = insert(SeenRow).values([{"user_id": user.id, "listing_id": i} for i in existing])
        await session.execute(ins.on_conflict_do_nothing())
        await session.commit()


@router.post("/visit", response_model=VisitOut)
async def visit(session: Session, user: User) -> VisitOut:
    """A visit starts after 30 min of inactivity. The feed hides what you saw in earlier visits."""
    now = datetime.now(UTC)
    st = await get_user_state(session, user.id, "visit")
    touched = datetime.fromisoformat(st["touched"]) if "touched" in st else None
    if touched is None or now - touched > VISIT_GAP:
        st["last"] = st.get("current")
        st["current"] = now.isoformat()
    st["touched"] = now.isoformat()
    await set_user_state(session, user.id, "visit", st)
    await session.commit()
    return VisitOut(
        visit_start=datetime.fromisoformat(st["current"]),
        last_visit=datetime.fromisoformat(st["last"]) if st.get("last") else None,
    )
