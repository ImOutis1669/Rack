"""ntfy push (https://ntfy.sh or self-hosted). Uses JSON publishing, so titles can be UTF-8."""

import httpx

from rack.notify.base import Notification, NotifyError
from rack.sources.http import USER_AGENT


class NtfyChannel:
    name = "ntfy"

    def __init__(
        self,
        server: str,
        topic: str,
        token: str = "",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.server = server.rstrip("/")
        self.topic = topic
        self._token = token
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.server and self.topic)

    async def send(self, n: Notification) -> None:
        payload: dict[str, object] = {
            "topic": self.topic,
            "title": n.title[:250],
            "message": n.body[:3500],
            "priority": n.priority,
            "tags": n.tags,
        }
        if n.url:
            payload["click"] = n.url
            payload["actions"] = [{"action": "view", "label": "Open listing", "url": n.url}]
        if n.image_url:
            payload["attach"] = n.image_url
        headers = {"User-Agent": USER_AGENT}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        async with httpx.AsyncClient(timeout=15, transport=self._transport) as client:
            try:
                resp = await client.post(self.server, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                raise NotifyError(f"ntfy unreachable: {exc}") from exc
        if resp.status_code >= 300:
            raise NotifyError(f"ntfy HTTP {resp.status_code}: {resp.text[:200]}")
