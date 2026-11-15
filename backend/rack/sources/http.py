"""Polite HTTP client: one request in flight per source, minimum interval + jitter, backoff."""

import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

USER_AGENT = "Rack/0.1 (personal, low-volume fashion feed; self-hosted)"
RETRY_STATUS = {429, 500, 502, 503, 504}


class RateLimitedClient:
    def __init__(
        self,
        min_interval: float,
        *,
        jitter: float = 0.3,
        max_retries: int = 3,
        backoff_base: float = 5.0,
        timeout: float = 20.0,
        headers: dict[str, str] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.min_interval = min_interval
        self.jitter = jitter
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._sleep = sleep
        self._clock = clock
        self._lock = asyncio.Lock()
        self._last: float | None = None
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, **(headers or {})},
            transport=transport,
            follow_redirects=True,
        )

    @property
    def cookies(self) -> httpx.Cookies:
        return self._client.cookies

    async def _wait_turn(self) -> None:
        if self._last is None:
            return
        gap = self.min_interval * (1 + random.uniform(0, self.jitter))
        remaining = gap - (self._clock() - self._last)
        if remaining > 0:
            await self._sleep(remaining)

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async with self._lock:
            attempt = 0
            while True:
                await self._wait_turn()
                self._last = self._clock()
                resp = await self._client.request(method, url, **kwargs)
                if resp.status_code not in RETRY_STATUS or attempt >= self.max_retries:
                    return resp
                retry_after = resp.headers.get("Retry-After")
                delay = (
                    float(retry_after)
                    if retry_after and retry_after.isdigit()
                    else self.backoff_base * (2**attempt)
                )
                attempt += 1
                await self._sleep(delay)

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", url, **kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()
