import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.sources.base import Listing, SearchQuery, SourceError
from rack.sources.ebay import parse_search
from rack.worker.refresh import refresh_all
from tests.conftest import PASSWORD, login

pytestmark = pytest.mark.db

FIXTURE = Path(__file__).parent / "fixtures" / "ebay" / "search_sample.json"


async def test_feed_requires_login(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/feed")).status_code == 401
    assert (await client.get("/api/health")).status_code == 200


async def test_wrong_password_then_rate_limited(client: httpx.AsyncClient) -> None:
    for _ in range(5):
        r = await client.post("/api/auth/login", json={"password": "nope"})
        assert r.status_code == 401
    r = await client.post("/api/auth/login", json={"password": PASSWORD})
    assert r.status_code == 429


async def test_csrf_header_required_for_mutations(client: httpx.AsyncClient) -> None:
    assert (await client.post("/api/_test/mutate")).status_code == 401
    await login(client)
    assert (await client.post("/api/_test/mutate")).status_code == 403
    r = await client.post("/api/_test/mutate", headers={"X-Requested-With": "rack"})
    assert r.status_code == 200


async def test_feed_lists_ingested_listings_with_pagination(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    listings = parse_search(json.loads(FIXTURE.read_text(encoding="utf-8")))
    async with sessions() as s:
        await upsert_listings(s, listings)
        await upsert_listings(s, listings)  # idempotent
        await s.commit()

    await login(client)
    r = await client.get("/api/feed", params={"limit": 1})
    assert r.status_code == 200
    page = r.json()
    assert len(page["items"]) == 1 and page["next_cursor"]
    first = page["items"][0]
    assert first["buy_links"][0]["url"].startswith("https://www.ebay.co.uk/itm/")
    assert first["images"]

    r2 = await client.get("/api/feed", params={"limit": 1, "cursor": page["next_cursor"]})
    page2 = r2.json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
    assert page2["items"][0]["id"] != first["id"]

    cheap = (await client.get("/api/feed", params={"sort": "price_asc"})).json()["items"]
    prices = [float(i["price_gbp"]) for i in cheap]
    assert prices == sorted(prices)

    only_under_100 = (await client.get("/api/feed", params={"max_price": 100})).json()["items"]
    assert all(float(i["price_gbp"]) <= 100 for i in only_under_100)


class _Broken:
    name = "vinted"

    async def search(self, query: SearchQuery) -> list[Listing]:
        raise SourceError("blocked")

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return None


class _Fixture:
    name = "ebay"

    async def search(self, query: SearchQuery) -> list[Listing]:
        return parse_search(json.loads(FIXTURE.read_text(encoding="utf-8")))

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return None


async def test_broken_source_does_not_break_refresh(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    results = await refresh_all([_Broken(), _Fixture()], [SearchQuery(text="x")], sessions)
    assert results == {"vinted": 0, "ebay": 2}

    await login(client)
    health = {h["source"]: h for h in (await client.get("/api/sources/health")).json()}
    assert health["ebay"]["status"] == "ok" and health["ebay"]["last_result_count"] == 2
    assert health["vinted"]["status"] == "degraded" and health["vinted"]["error_count"] == 1
    assert health["grailed"]["status"] == "never_run"
