"""Notification channel status and a test button."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import Settings, get_settings
from rack.db import get_session, sessionmaker
from rack.models import NotificationRow, PushSubscriptionRow
from rack.notify.base import Notification
from rack.notify.dispatch import build_channels, send_all

router = APIRouter(prefix="/api/notify", tags=["notify"], dependencies=[Depends(require_session)])
Config = Annotated[Settings, Depends(get_settings)]


class ChannelStatus(BaseModel):
    name: str
    configured: bool
    detail: str


class SentOut(BaseModel):
    kind: str
    title: str
    body: str
    url: str | None
    channels: dict[str, str]
    sent_at: str


@router.get("/status", response_model=list[ChannelStatus])
async def status(
    settings: Config, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[ChannelStatus]:
    devices = (await session.execute(select(func.count(PushSubscriptionRow.id)))).scalar_one()
    push_keys = bool(settings.vapid_public_key and settings.vapid_private_key)
    ntfy_on = bool(settings.ntfy_url and settings.ntfy_topic)
    return [
        ChannelStatus(
            name="ntfy",
            configured=ntfy_on,
            detail=(
                f"In the ntfy app, subscribe to {settings.ntfy_topic} on {settings.ntfy_url}"
                if ntfy_on
                else "Set NTFY_TOPIC in .env (and NTFY_URL for a self-hosted server)"
            ),
        ),
        ChannelStatus(
            name="telegram",
            configured=bool(settings.telegram_bot_token and settings.telegram_chat_id),
            detail="Sends to your bot chat"
            if settings.telegram_bot_token and settings.telegram_chat_id
            else "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env",
        ),
        ChannelStatus(
            name="webpush",
            configured=push_keys and devices > 0,
            detail=(
                f"{devices} device(s) enabled"
                if push_keys
                else "Run `rack vapid-keys` and add the keys to .env"
            ),
        ),
    ]


@router.post("/test", response_model=dict[str, str])
async def test(settings: Config) -> dict[str, str]:
    channels = build_channels(settings, sessionmaker())
    if not channels:
        return {"error": "No notification channel is configured"}
    return await send_all(
        channels,
        Notification(
            title="Rack test notification",
            body="If you can read this, hunt and price-drop alerts will reach you.",
            url=settings.rack_public_url,
            tags=["white_check_mark"],
        ),
    )


@router.get("/recent", response_model=list[SentOut])
async def recent(session: Annotated[AsyncSession, Depends(get_session)]) -> list[SentOut]:
    rows = (
        await session.execute(
            select(NotificationRow).order_by(NotificationRow.sent_at.desc()).limit(30)
        )
    ).scalars()
    return [
        SentOut(
            kind=r.kind,
            title=r.title,
            body=r.body,
            url=r.url,
            channels={k: str(v) for k, v in (r.channels or {}).items()},
            sent_at=r.sent_at.isoformat(),
        )
        for r in rows
    ]
