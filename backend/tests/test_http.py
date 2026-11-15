import httpx

from rack.sources.http import USER_AGENT, RateLimitedClient


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


async def test_enforces_min_interval_between_requests() -> None:
    t = FakeTime()
    transport = httpx.MockTransport(lambda r: httpx.Response(200))
    client = RateLimitedClient(10, jitter=0, transport=transport, sleep=t.sleep, clock=t.clock)
    await client.get("https://example.test/a")
    await client.get("https://example.test/b")
    assert t.slept == [10]
    await client.aclose()


async def test_retries_429_with_retry_after_then_succeeds() -> None:
    t = FakeTime()
    responses = iter([httpx.Response(429, headers={"Retry-After": "30"}), httpx.Response(200)])
    transport = httpx.MockTransport(lambda r: next(responses))
    client = RateLimitedClient(0, jitter=0, transport=transport, sleep=t.sleep, clock=t.clock)
    resp = await client.get("https://example.test/")
    assert resp.status_code == 200
    assert 30 in t.slept
    await client.aclose()


async def test_gives_up_after_max_retries() -> None:
    t = FakeTime()
    transport = httpx.MockTransport(lambda r: httpx.Response(503))
    client = RateLimitedClient(
        0,
        jitter=0,
        max_retries=2,
        backoff_base=1,
        transport=transport,
        sleep=t.sleep,
        clock=t.clock,
    )
    resp = await client.get("https://example.test/")
    assert resp.status_code == 503
    assert t.slept == [1, 2]
    await client.aclose()


async def test_sends_honest_user_agent() -> None:
    seen: list[str] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r.headers["User-Agent"])
        return httpx.Response(200)

    client = RateLimitedClient(0, transport=httpx.MockTransport(handler))
    await client.get("https://example.test/")
    assert seen == [USER_AGENT]
    await client.aclose()
