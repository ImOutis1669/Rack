"""Telegram bot messages. The bot token is part of the API URL, so it is never logged."""

import html

import httpx

from rack.notify.base import Notification, NotifyError

API = "https://api.telegram.org"


class TelegramChannel:
    name = "telegram"

    def __init__(
        self, bot_token: str, chat_id: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._token = bot_token
        self.chat_id = chat_id
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._token and self.chat_id)

    def _text(self, n: Notification) -> str:
        parts = [f"<b>{html.escape(n.title)}</b>", html.escape(n.body)]
        if n.url:
            parts.append(f'<a href="{html.escape(n.url, quote=True)}">Open listing</a>')
        return "\n".join(p for p in parts if p)

    async def send(self, n: Notification) -> None:
        text = self._text(n)
        if n.image_url:
            method = "sendPhoto"
            data: dict[str, object] = {
                "chat_id": self.chat_id,
                "photo": n.image_url,
                "caption": text[:1024],
                "parse_mode": "HTML",
            }
        else:
            method = "sendMessage"
            data = {"chat_id": self.chat_id, "text": text[:4096], "parse_mode": "HTML"}
        async with httpx.AsyncClient(timeout=15, transport=self._transport) as client:
            try:
                resp = await client.post(f"{API}/bot{self._token}/{method}", json=data)
                if resp.status_code >= 300 and method == "sendPhoto":
                    # Telegram couldn't fetch the image: fall back to plain text
                    resp = await client.post(
                        f"{API}/bot{self._token}/sendMessage",
                        json={"chat_id": self.chat_id, "text": text[:4096], "parse_mode": "HTML"},
                    )
            except httpx.HTTPError as exc:
                raise NotifyError(f"Telegram unreachable: {type(exc).__name__}") from None
        if resp.status_code >= 300:
            desc = resp.json().get("description", "") if resp.content else ""
            raise NotifyError(f"Telegram HTTP {resp.status_code}: {desc[:200]}")
