"""Web Push to the installed Rack PWA (phone or desktop), signed with your VAPID keys."""

import asyncio
import base64
import json
import logging

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import PushSubscriptionRow
from rack.notify.base import Notification, NotifyError

log = logging.getLogger(__name__)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def generate_vapid_keys() -> tuple[str, str]:
    """(public, private) as unpadded base64url: browser applicationServerKey + raw private key."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64(public), _b64(private)


def payload(n: Notification) -> str:
    return json.dumps(
        {"title": n.title, "body": n.body, "url": n.url, "image": n.image_url, "tag": n.url}
    )


class WebPushChannel:
    name = "webpush"

    def __init__(
        self,
        public_key: str,
        private_key: str,
        subject: str,
        sessions: async_sessionmaker[AsyncSession] | None,
    ) -> None:
        self.public_key = public_key
        self._private = private_key
        # VAPID "sub" must be a mailto: or https: URL; using the app's own URL avoids an email.
        self._subject = (
            subject if subject.startswith(("https://", "mailto:")) else "https://localhost"
        )
        self._sessions = sessions

    @property
    def configured(self) -> bool:
        return bool(self.public_key and self._private and self._sessions is not None)

    def _send_one(self, sub: PushSubscriptionRow, data: str) -> int | None:
        """Returns an HTTP status to act on (404/410 = gone), else None."""
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": sub.keys},
                data=data,
                vapid_private_key=self._private,
                vapid_claims={"sub": self._subject},
                ttl=24 * 3600,
                timeout=15,
            )
        except WebPushException as exc:
            status: int | None = int(exc.response.status_code) if exc.response is not None else None
            if status in (404, 410):
                return status
            raise NotifyError(f"push service HTTP {status}") from None
        return None

    async def send(self, n: Notification) -> None:
        assert self._sessions is not None
        async with self._sessions() as s:
            subs = (await s.execute(select(PushSubscriptionRow))).scalars().all()
            if not subs:
                raise NotifyError("no device has enabled push yet")
            data = payload(n)
            sent, errors, gone = 0, [], []
            for sub in subs:
                try:
                    status = await asyncio.to_thread(self._send_one, sub, data)
                except NotifyError as exc:
                    errors.append(str(exc))
                    continue
                if status in (404, 410):
                    gone.append(sub.id)
                else:
                    sent += 1
            if gone:
                await s.execute(delete(PushSubscriptionRow).where(PushSubscriptionRow.id.in_(gone)))
                await s.commit()
                log.info("removed %d expired push subscriptions", len(gone))
        if not sent:
            raise NotifyError("; ".join(errors) or "all push subscriptions had expired")
