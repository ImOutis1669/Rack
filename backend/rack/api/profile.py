"""Taste profile, designers and adjacent designers."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.db import get_session
from rack.models import AdjacentDesignerRow, DesignerRow, TasteItemRow
from rack.profile import Profile
from rack.store import bump_version, get_profile_row, load_designers

router = APIRouter(prefix="/api", tags=["profile"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]

SEED = Path(__file__).resolve().parent.parent / "data" / "adjacent_designers.json"


@lru_cache
def seed_adjacent() -> dict[str, list[str]]:
    data: dict[str, list[str]] = json.loads(SEED.read_text(encoding="utf-8"))
    return {k.lower(): v for k, v in data.items()}


class ProfileOut(BaseModel):
    profile: Profile
    version: int
    designer_count: int
    taste_count: int


class DesignerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    weight: Literal["love", "like", "curious", "exclude"]


@router.get("/profile", response_model=ProfileOut)
async def get_profile(session: Session) -> ProfileOut:
    row = await get_profile_row(session)
    await session.commit()
    designers = (await session.execute(select(func.count(DesignerRow.id)))).scalar_one()
    taste = (await session.execute(select(func.count(TasteItemRow.id)))).scalar_one()
    return ProfileOut(
        profile=Profile.model_validate(row.data),
        version=row.version,
        designer_count=designers,
        taste_count=taste,
    )


@router.put("/profile", response_model=ProfileOut)
async def put_profile(body: Profile, session: Session) -> ProfileOut:
    row = await get_profile_row(session)
    row.data = body.model_dump(mode="json")
    await bump_version(session)
    await session.commit()
    return await get_profile(session)


@router.get("/designers", response_model=list[DesignerIn])
async def get_designers(session: Session) -> list[DesignerIn]:
    return [DesignerIn(name=n, weight=w) for n, w in (await load_designers(session)).items()]


@router.put("/designers", response_model=list[DesignerIn])
async def put_designers(body: list[DesignerIn], session: Session) -> list[DesignerIn]:
    before = {n.lower() for n in await load_designers(session)}
    seen: set[str] = set()
    await session.execute(delete(DesignerRow))
    for d in body:
        name = " ".join(d.name.split())
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        session.add(DesignerRow(name=name, weight=d.weight))
        # first time we see a loved/liked designer: seed its adjacent designers (editable later)
        if name.lower() not in before and d.weight in ("love", "like"):
            existing = set(
                (
                    await session.execute(
                        select(AdjacentDesignerRow.adjacent).where(
                            AdjacentDesignerRow.designer == name
                        )
                    )
                ).scalars()
            )
            for adj in seed_adjacent().get(name.lower(), []):
                if adj not in existing:
                    session.add(AdjacentDesignerRow(designer=name, adjacent=adj))
    await bump_version(session)
    await session.commit()
    return await get_designers(session)


@router.get("/adjacent", response_model=dict[str, list[str]])
async def get_adjacent(session: Session) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    rows = await session.execute(select(AdjacentDesignerRow).order_by(AdjacentDesignerRow.id))
    for r in rows.scalars():
        out.setdefault(r.designer, []).append(r.adjacent)
    return out


@router.put("/adjacent", response_model=dict[str, list[str]])
async def put_adjacent(body: dict[str, list[str]], session: Session) -> dict[str, list[str]]:
    await session.execute(delete(AdjacentDesignerRow))
    for designer, adjs in body.items():
        for adj in dict.fromkeys(a.strip() for a in adjs if a.strip()):
            session.add(AdjacentDesignerRow(designer=designer.strip(), adjacent=adj[:200]))
    await bump_version(session)
    await session.commit()
    return await get_adjacent(session)
