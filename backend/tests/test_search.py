"""v2.1 step 4b: search across all sources (instant over stored listings, live via the worker)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import ListingRow, SearchRequestRow
from rack.search import clean_query
from rack.sources.base import Listing, SearchQuery, SourceError, SourceNotConfigured
from rack.store import get_user_state
from rack.worker.live_search import run_live_searches
from tests.conftest import OWNER, login, make_user

H = {"X-Requested-With": "rack"}
SAM_PW = "sam-password-long"


def item(
    sid: str,
    title: str,
    brand: str | None = None,
    *,
    source: str = "vinted",
    price: str = "200",
    size: str | None = None,
    description: str | None = None,
) -> Listing:
    return Listing(
        source=source,
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=title,
        brand=brand,
        description=description,
        price=Decimal(price),
        currency="GBP",
        price_gbp=Decimal(price),
        size=size,
        images=[f"https://images1.vinted.net/t/{sid}/f800/a.jpeg"],
    )


CATALOGUE = [
    item("1", "Rick Owens Geobasket black leather", "Rick Owens", size="EU 43", price="450"),
    item("2", "Tabi split toe boots", "Maison Margiela", size="43", price="380"),
    item("3", "Margiela tabi ankle boots 43", None, price="300"),
    item("4", "Plain white tee", "Uniqlo", price="10"),
    item("5", "Lemaire twisted shirt", "Lemaire", description="cotton poplin, perfect condition"),
    item("6", "Geobasket womens", "Rick Owens", price="200"),  # excluded below
    item("7", "Rick Owens geobasket sold", "Rick Owens"),  # inactive below
]


async def seed(sessions: async_sessionmaker[AsyncSession]) -> dict[str, int]:
    async with sessions() as s:
        ids = await upsert_listings(s, CATALOGUE)
        by_sid = {li.source_id: i for li, i in zip(CATALOGUE, ids, strict=True)}
        await s.execute(
            update(ListingRow).where(ListingRow.id == by_sid["6"]).values(excluded="womens")
        )
        await s.execute(update(ListingRow).where(ListingRow.id == by_sid["7"]).values(active=False))
        await s.commit()
    return by_sid


@asynccontextmanager
async def browser(client: httpx.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as c:
        yield c


async def ids_for(client: httpx.AsyncClient, url: str) -> list[int]:
    r = await client.get(url)
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()["items"]]


def test_clean_query() -> None:
    assert clean_query("  Rick   OWENS\n") == "rick owens"
    assert clean_query("a") == "" and clean_query("  !! ") == ""
    assert len(clean_query("x" * 500)) == 100


# --- instant ---


@pytest.mark.db
async def test_instant_search_matches_typos_words_and_filters(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    ids = await seed(sessions)
    await login(client)
    assert await ids_for(client, "/api/search?q=geobaskt") == [ids["1"]]  # typo
    tabi = await ids_for(client, "/api/search?q=margiela%20tabi")
    assert set(tabi) == {ids["2"], ids["3"]}  # brand field or title, either way
    assert await ids_for(client, "/api/search?q=poplin") == [ids["5"]]  # description
    assert await ids_for(client, "/api/search?q=tabi&source=grailed") == []
    assert await ids_for(client, "/api/search?q=tabi&size=43") == [ids["2"]]
    assert await ids_for(client, "/api/search?q=tabi&max_price=350") == [ids["3"]]
    assert await ids_for(client, "/api/search?q=tabi&sort=price_desc") == [ids["2"], ids["3"]]
    assert await ids_for(client, "/api/search?q=uniqlo") == [ids["4"]]
    assert await ids_for(client, "/api/search?q=prada") == []
    # excluded (women's) and inactive listings never show
    assert ids["6"] not in await ids_for(client, "/api/search?q=geobasket")
    assert ids["7"] not in await ids_for(client, "/api/search?q=geobasket")
    assert (await client.get("/api/search?q=a")).status_code == 422
    assert (await client.get("/api/search?q=tabi&cursor=bad")).status_code == 422

    first = (await client.get("/api/search?q=tabi&limit=1")).json()
    assert len(first["items"]) == 1 and first["next_cursor"]
    second = (await client.get(f"/api/search?q=tabi&limit=1&cursor={first['next_cursor']}")).json()
    assert second["items"][0]["id"] != first["items"][0]["id"] and second["next_cursor"] is None


@pytest.mark.db
async def test_like_wildcards_are_literal(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await seed(sessions)
    await login(client)
    assert await ids_for(client, "/api/search?q=tabi&size=%25") == []  # "%" isn't "anything"


@pytest.mark.db
async def test_your_hides_and_purchases_apply_only_to_you(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    ids = await seed(sessions)
    await make_user(sessions, OWNER, "owner")
    await make_user(sessions, "sam", password=SAM_PW)
    await login(client)
    await client.post("/api/hidden", json={"kind": "brand", "value": "Maison Margiela"}, headers=H)
    await client.post(f"/api/listings/{ids['3']}/bought", json={"price_gbp": "1"}, headers=H)
    assert await ids_for(client, "/api/search?q=tabi") == []
    async with browser(client) as sam:
        await login(sam, "sam", SAM_PW)
        assert set(await ids_for(sam, "/api/search?q=tabi")) == {ids["2"], ids["3"]}


# --- live ---


class Fake:
    def __init__(self, name: str, result: list[Listing] | Exception) -> None:
        self.name = name
        self.result = result
        self.asked: list[SearchQuery] = []

    async def search(self, query: SearchQuery) -> list[Listing]:
        self.asked.append(query)
        if isinstance(self.result, Exception):
            raise self.result
        return list(self.result)


@pytest.mark.db
async def test_live_search_runs_once_per_source_and_reports(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    owner_id = await make_user(sessions, OWNER, "owner")
    await login(client)
    r = await client.post(
        "/api/search/live", json={"q": " Junya  Watanabe ", "max_price_gbp": 300}, headers=H
    )
    assert r.status_code == 202, r.text
    req = r.json()
    assert (req["status"], req["query"], req["items"]) == ("queued", "junya watanabe", [])
    again = await client.post("/api/search/live", json={"q": "kapital"}, headers=H)
    assert again.status_code == 409  # one at a time

    vinted = Fake("vinted", [item("v1", "Junya Watanabe patchwork jacket", "Junya Watanabe")])
    grailed = Fake("grailed", SourceError("HTTP 500"))
    ebay = Fake(
        "ebay",
        [item("e1", "Junya Watanabe MAN denim", "Junya Watanabe", source="ebay")],
    )
    assert (
        await run_live_searches(sessions, {"vinted": vinted, "grailed": grailed, "ebay": ebay}) == 1
    )
    assert [q.text for q in vinted.asked] == ["junya watanabe"]  # once per source
    assert vinted.asked[0].max_price_gbp == Decimal(300)

    done = (await client.get(f"/api/search/live/{req['id']}")).json()
    assert done["status"] == "done" and done["finished_at"]
    assert done["results"] == {"vinted": 1, "grailed": "failed", "ebay": 1}
    assert {i["title"] for i in done["items"]} == {
        "Junya Watanabe patchwork jacket",
        "Junya Watanabe MAN denim",
    }
    # results are ordinary listings now, so the instant search finds them too
    assert len(await ids_for(client, "/api/search?q=junya")) == 2
    async with sessions() as s:  # eBay's shared quota: counted for the owner's admin view
        assert (await get_user_state(s, owner_id, "ebay_usage"))["search"] == 1
    assert await run_live_searches(sessions, {"vinted": vinted}) == 0  # nothing queued


@pytest.mark.db
async def test_live_search_limits_and_privacy(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, "sam", password=SAM_PW)
    await login(client)
    mine = (await client.post("/api/search/live", json={"q": "kapital"}, headers=H)).json()
    off = Fake("vinted", SourceNotConfigured("no"))
    await run_live_searches(sessions, {"vinted": off})
    gone = (await client.get(f"/api/search/live/{mine['id']}")).json()
    assert gone["status"] == "error" and gone["results"] == {"vinted": "not set up"}
    # the owner waits 10 s between live searches
    r = await client.post("/api/search/live", json={"q": "lemaire"}, headers=H)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) <= 10

    async with browser(client) as sam:
        await login(sam, "sam", SAM_PW)
        assert (await sam.get(f"/api/search/live/{mine['id']}")).status_code == 404  # not hers
        first = await sam.post("/api/search/live", json={"q": "visvim"}, headers=H)
        assert first.status_code == 202
        async with sessions() as s:  # finished, but friends wait 2 minutes
            await s.execute(
                update(SearchRequestRow)
                .where(SearchRequestRow.user_id == sam_id)
                .values(status="done", created_at=datetime.now(UTC) - timedelta(seconds=90))
            )
            await s.commit()
        r = await sam.post("/api/search/live", json={"q": "visvim"}, headers=H)
        assert r.status_code == 429 and 25 <= int(r.headers["Retry-After"]) <= 31

        async with sessions() as s:  # a full queue turns new searches away
            await s.execute(
                update(SearchRequestRow)
                .where(SearchRequestRow.user_id == sam_id)
                .values(created_at=datetime.now(UTC) - timedelta(minutes=5))
            )
            for i in range(5):
                s.add(
                    SearchRequestRow(
                        user_id=sam_id,
                        query=f"q{i}",
                        status="queued",
                        created_at=datetime.now(UTC) - timedelta(minutes=20),
                    )
                )
            await s.commit()
        busy = await sam.post("/api/search/live", json={"q": "visvim"}, headers=H)
        assert busy.status_code == 429 and "busy" in busy.json()["detail"]


@pytest.mark.db
async def test_stale_and_old_requests_are_cleaned_up(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    uid = await make_user(sessions, OWNER, "owner")
    now = datetime.now(UTC)
    async with sessions() as s:
        s.add(
            SearchRequestRow(
                user_id=uid,
                query="stuck",
                status="running",
                created_at=now - timedelta(minutes=30),
                started_at=now - timedelta(minutes=30),
            )
        )
        s.add(
            SearchRequestRow(
                user_id=uid, query="old", status="done", created_at=now - timedelta(days=2)
            )
        )
        await s.commit()
    await run_live_searches(sessions, {}, now)
    async with sessions() as s:
        rows = {r.query: r.status for r in (await s.execute(select(SearchRequestRow))).scalars()}
    assert rows == {"stuck": "error"}  # crashed run given up; day-old query deleted


@pytest.mark.db
async def test_disabled_accounts_searches_never_run(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    """RACK-24: disabling a friend also stops what they queued."""
    sam = await make_user(sessions, "sam", password=SAM_PW)
    async with sessions() as s:
        s.add(
            SearchRequestRow(
                user_id=sam, query="visvim", status="queued", created_at=datetime.now(UTC)
            )
        )
        from rack.models import UserRow

        u = await s.get(UserRow, sam)
        assert u is not None
        u.disabled_at = datetime.now(UTC)
        await s.commit()
    vinted = Fake("vinted", [])
    assert await run_live_searches(sessions, {"vinted": vinted}) == 0
    assert vinted.asked == []
    async with sessions() as s:
        assert (await s.execute(select(SearchRequestRow.status))).scalar_one() == "error"
