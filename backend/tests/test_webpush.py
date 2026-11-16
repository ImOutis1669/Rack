import base64
import json
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import PushSubscriptionRow
from rack.notify import webpush as wp
from rack.notify.base import Notification, NotifyError
from tests.conftest import login

H = {"X-Requested-With": "rack"}


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def test_vapid_keys_have_the_shapes_browsers_expect() -> None:
    public, private = wp.generate_vapid_keys()
    pub = _unb64(public)
    assert len(pub) == 65 and pub[0] == 4  # uncompressed P-256 point
    assert len(_unb64(private)) == 32


def test_payload_is_what_the_service_worker_reads() -> None:
    data = json.loads(wp.payload(Notification("t", "b", url="https://x/1", image_url="https://i")))
    assert data == {
        "title": "t",
        "body": "b",
        "url": "https://x/1",
        "image": "https://i",
        "tag": "https://x/1",
    }


class FakeResponse:
    def __init__(self, status: int) -> None:
        self.status_code = status


@pytest.mark.db
async def test_subscribe_send_and_drop_expired(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await login(client)
    for i in (1, 2):
        r = await client.post(
            "/api/push/subscribe",
            json={"endpoint": f"https://push.example/{i}", "keys": {"p256dh": "k", "auth": "a"}},
            headers=H,
        )
        assert r.status_code == 204
    bad = await client.post(
        "/api/push/subscribe",
        json={"endpoint": "http://insecure", "keys": {"p256dh": "k", "auth": "a"}},
        headers=H,
    )
    assert bad.status_code == 422

    calls: list[dict[str, Any]] = []

    def fake_webpush(**kw: Any) -> None:
        calls.append(kw)
        if kw["subscription_info"]["endpoint"].endswith("/2"):
            raise wp.WebPushException("gone", response=FakeResponse(410))

    monkeypatch.setattr(wp, "webpush", fake_webpush)
    public, private = wp.generate_vapid_keys()
    ch = wp.WebPushChannel(public, private, "https://rack.example", sessions)
    await ch.send(Notification("Price drop", "£200 → £170"))
    assert len(calls) == 2
    assert calls[0]["vapid_claims"] == {"sub": "https://rack.example"}
    async with sessions() as s:
        left = (await s.execute(select(PushSubscriptionRow.endpoint))).scalars().all()
    assert left == ["https://push.example/1"]  # the expired one was removed

    await client.post(
        "/api/push/unsubscribe", json={"endpoint": "https://push.example/1"}, headers=H
    )
    with pytest.raises(NotifyError, match="no device"):
        await ch.send(Notification("x", "y"))
