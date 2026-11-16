import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.sources.base import Category, SearchQuery, SourceError, SourceNotConfigured
from rack.sources.vestiaire import RUN_URL, VestiaireApifyAdapter, build_input, parse_items
from rack.store import set_state
from tests.conftest import login

# Hand-built from the actor's documented output fields; replace with a recorded run.
ROWS = json.loads(
    (Path(__file__).parent / "fixtures" / "vestiaire" / "search_sample.json").read_text("utf-8")
)
H = {"X-Requested-With": "rack"}


def test_parse_keeps_enriched_row_and_drops_womens_and_sold() -> None:
    [item] = parse_items(ROWS)
    assert item.source == "vestiaire" and item.source_id == "51234567"
    assert item.description == "Drawstring waist. Inseam 84 cm."
    assert len(item.images) == 3
    assert (item.price, item.price_gbp, item.size) == (Decimal(240), Decimal("240.00"), "48 IT")


def test_input_uses_uk_residential_proxies_and_caps() -> None:
    body = build_input(
        SearchQuery(text="rick owens", category=Category.TROUSERS, max_price_gbp=Decimal(300)),
        500,
        False,
    )
    assert body["searchKeywords"] == ["rick owens"]
    assert body["searchMaxResults"] == 200  # actor maximum
    assert body["searchSort"] == "newest" and body["searchMaxPrice"] == 300
    assert body["country"] == "UK"
    assert body["proxyConfiguration"]["apifyProxyGroups"] == ["RESIDENTIAL"]
    assert body["proxyConfiguration"]["apifyProxyCountry"] == "GB"


async def test_adapter_sends_token_in_header_and_maps_errors() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if len(seen) == 1:
            return httpx.Response(201, json=ROWS)
        return httpx.Response(402, json={"error": {"type": "not-enough-usage"}})

    a = VestiaireApifyAdapter("tok", max_results=3, transport=httpx.MockTransport(handler))
    assert len(await a.search(SearchQuery(text="rick owens"))) == 1
    req = seen[0]
    assert str(req.url) == RUN_URL and "token" not in str(req.url)
    assert req.headers["authorization"] == "Bearer tok"
    assert json.loads(req.content)["searchMaxResults"] == 3
    with pytest.raises(SourceError, match="payment"):
        await a.search(SearchQuery(text="x"))
    await a.aclose()
    with pytest.raises(SourceNotConfigured):
        await VestiaireApifyAdapter("").search(SearchQuery(text="x"))


@pytest.mark.db
async def test_refresh_button_queues_once_and_respects_cooldown(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    r = (await client.post("/api/refresh", headers=H)).json()
    assert r["queued"] is True and r["message"] == "Searching the sources now."
    again = (await client.post("/api/refresh", headers=H)).json()
    assert again["message"] == "Already searching the sources."

    # the worker picked it up and finished just now -> cooldown
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()
    async with sessions() as s:
        await set_state(
            s,
            "refresh",
            {"running": False, "started_at": now, "at": now, "results": {"vinted": 50}},
        )
        await s.commit()
    r = (await client.post("/api/refresh", headers=H)).json()
    assert r["queued"] is False and r["next_allowed_at"] and "try again" in r["message"]
    assert r["results"] == {"vinted": 50}
