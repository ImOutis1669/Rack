import json
from decimal import Decimal

import httpx
import pytest

from rack.notify.base import Notification, NotifyError
from rack.notify.ntfy import NtfyChannel
from rack.notify.telegram import TelegramChannel
from rack.ranking.hunt_match import HuntSpec, hunt_matches
from rack.sources.base import Category
from rack.worker.price_drops import is_drop


def m(spec: HuntSpec, **kw: object) -> bool:
    base: dict[str, object] = dict(
        title="", brand=None, description=None, price_gbp=None, size=None
    )
    base.update(kw)
    return hunt_matches(spec, **base)  # type: ignore[arg-type]


def test_hunt_requires_every_query_word() -> None:
    spec = HuntSpec(query="rick owens geobasket")
    assert m(spec, title="Geobasket black leather", brand="Rick Owens")
    assert not m(spec, title="Rick Owens ramones")  # Vinted's fuzzy search returns these
    assert m(spec, title="Sneakers", brand="Rick Owens", description="the classic geobasket")


def test_hunt_filters_strict_when_known_lenient_when_unknown() -> None:
    spec = HuntSpec(
        query="lemaire", category=Category.TROUSERS, max_price_gbp=200, sizes=["32"], min_score=0.4
    )
    ok = dict(title="Lemaire twisted trousers", size="32", price_gbp=150.0, score=0.5)
    assert m(spec, **ok)
    assert not m(spec, **{**ok, "price_gbp": 250.0})
    assert not m(spec, **{**ok, "title": "Lemaire twisted shirt"})
    assert not m(spec, **{**ok, "size": "36"})
    assert not m(spec, **{**ok, "score": 0.2})
    assert m(spec, title="Lemaire piece", size=None, price_gbp=None, score=None)


def test_price_drop_needs_both_thresholds() -> None:
    assert is_drop(Decimal(200), Decimal(180), 5, 5)
    assert not is_drop(Decimal(200), Decimal(197), 5, 5)  # 1.5%
    assert not is_drop(Decimal(40), Decimal(36), 5, 5)  # 10% but only £4
    assert not is_drop(None, Decimal(10), 5, 5)


async def test_ntfy_publishes_json_with_link_and_image() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"id": "x"})

    ch = NtfyChannel(
        "https://ntfy.example/", "rack-secret", token="t", transport=httpx.MockTransport(handler)
    )
    await ch.send(
        Notification("Lemaire — £120", "size 32", url="https://x/1", image_url="https://img/1.jpg")
    )
    body = json.loads(seen[0].content)
    assert str(seen[0].url) == "https://ntfy.example"
    assert body["topic"] == "rack-secret" and body["title"] == "Lemaire — £120"
    assert body["click"] == "https://x/1" and body["attach"] == "https://img/1.jpg"
    assert seen[0].headers["authorization"] == "Bearer t"


async def test_telegram_escapes_falls_back_and_hides_token() -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.path.rsplit("/", 1)[-1])
        if calls[-1] == "sendPhoto":
            return httpx.Response(400, json={"ok": False, "description": "wrong file"})
        text = json.loads(req.content)["text"]
        assert "&lt;b&gt;" in text and '<a href="https://x/1">' in text
        return httpx.Response(200, json={"ok": True})

    ch = TelegramChannel("123:SECRET", "42", transport=httpx.MockTransport(handler))
    await ch.send(Notification("<b>Rick</b>", "£90", url="https://x/1", image_url="https://img"))
    assert calls == ["sendPhoto", "sendMessage"]

    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=req)

    with pytest.raises(NotifyError) as err:
        await TelegramChannel("123:SECRET", "42", transport=httpx.MockTransport(boom)).send(
            Notification("t", "b")
        )
    assert "SECRET" not in str(err.value)
