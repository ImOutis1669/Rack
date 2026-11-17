"""Web Push subscriptions for the installed app."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import User, require_session
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.models import PushSubscriptionRow

router = APIRouter(prefix="/api/push", tags=["push"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000, pattern=r"^https://")
    keys: Keys


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/key")
async def public_key(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str | None]:
    return {"public_key": settings.vapid_public_key or None}


@router.post("/subscribe", status_code=204)
async def subscribe(body: SubscriptionIn, request: Request, session: Session, user: User) -> None:
    """A browser's endpoint belongs to whoever subscribed it last (one account per browser)."""
    ins = insert(PushSubscriptionRow).values(
        user_id=user.id,
        endpoint=body.endpoint,
        keys=body.keys.model_dump(),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    await session.execute(
        ins.on_conflict_do_update(
            index_elements=[PushSubscriptionRow.endpoint],
            set_={"keys": ins.excluded["keys"], "user_id": user.id},
        )
    )
    await session.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(body: EndpointIn, session: Session, user: User) -> None:
    await session.execute(
        delete(PushSubscriptionRow).where(
            PushSubscriptionRow.endpoint == body.endpoint, PushSubscriptionRow.user_id == user.id
        )
    )
    await session.commit()
