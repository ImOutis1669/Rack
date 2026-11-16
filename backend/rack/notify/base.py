"""Notification model and channel interface."""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class Notification:
    title: str
    body: str
    url: str | None = None
    image_url: str | None = None
    tags: list[str] = field(default_factory=list)  # ntfy emoji tags, e.g. ["mag"]
    priority: int = 3  # 1 (min) .. 5 (max), ntfy scale


class NotifyError(Exception):
    pass


class Channel(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    async def send(self, n: Notification) -> None: ...
