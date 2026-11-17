from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings, get_settings
from rack.ingest import upsert_listings
from rack.models import HiddenRow, HuntRow, NotificationRow, SavedRow
from rack.notify.base import Notification, NotifyError
from rack.notify.dispatch import notify_once
from rack.sources.base import Listing, SearchQuery, Seller
from rack.worker.hunts import run_due_hunts, run_hunt
from rack.worker.price_drops import check_saved_prices
from tests.conftest import db_owner, login

pytestmark = pytest.mark.db
H = {"X-Requested-With": "rack"}


def listing(sid: str, title: str, price: str = "120", seller: str = "good_seller") -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=title,
        price=Decimal(price),
        currency="GBP",
        price_gbp=Decimal(price),
        size="32",
        images=[f"https://img/{sid}.jpg"],
        seller=Seller(name=seller),
    )


class FakeAdapter:
    name = "vinted"

    def __init__(self) -> None:
        self.results: list[Listing] = []
        self.current: dict[str, Listing | None] = {}

    async def search(self, query: SearchQuery) -> list[Listing]:
        return list(self.results)

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return self.current.get(url_or_id)


class FakeChannel:
    name = "fake"
    configured = True

    def __init__(self, fail: bool = False) -> None:
        self.sent: list[Notification] = []
        self.fail = fail

    async def send(self, n: Notification) -> None:
        if self.fail:
            raise NotifyError("nope")
        self.sent.append(n)


async def test_hunt_api_crud_and_run_now(client: httpx.AsyncClient) -> None:
    await login(client)
    body = {
        "name": "Geobaskets",
        "query": "rick owens geobasket",
        "category": "shoes",
        "max_price_gbp": 400,
        "sizes": ["43"],
        "interval_minutes": 15,
    }
    h = (await client.post("/api/hunts", json=body, headers=H)).json()
    assert h["id"] and h["sources"] == [] and h["match_count"] == 0
    assert (
        await client.post("/api/hunts", json={**body, "interval_minutes": 1}, headers=H)
    ).status_code == 422
    r = (await client.post(f"/api/hunts/{h['id']}/run", headers=H)).json()
    assert r["run_requested_at"]
    r = (
        await client.put(f"/api/hunts/{h['id']}", json={**body, "enabled": False}, headers=H)
    ).json()
    assert r["enabled"] is False
    assert (await client.delete(f"/api/hunts/{h['id']}", headers=H)).status_code == 204
    assert (await client.get("/api/hunts")).json() == []


async def test_hunt_baseline_then_alerts_once_and_respects_hides(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    adapter, channel = FakeAdapter(), FakeChannel()
    adapters = {"vinted": adapter}
    async with sessions() as s:
        uid = await db_owner(s)
        hunt = HuntRow(
            user_id=uid,
            name="Belas", query="rick owens belas", sources=["vinted"], interval_minutes=30
        )
        s.add(hunt)
        s.add(HiddenRow(user_id=uid, kind="seller", value="Bad Seller"))
        await s.commit()
        hunt_id = hunt.id

    adapter.results = [listing("1", "Rick Owens Belas cargo"), listing("2", "Rick Owens ramones")]
    async with sessions() as s:
        h = await s.get(HuntRow, hunt_id)
        assert h is not None
        assert await run_hunt(s, h, adapters, [channel]) == 1
    assert channel.sent == []  # first run is the baseline: listings that already existed

    adapter.results += [
        listing("3", "Rick Owens Belas pants black", price="150"),
        listing("4", "Rick Owens Belas", seller="bad seller"),  # hidden seller
    ]
    async with sessions() as s:
        h = await s.get(HuntRow, hunt_id)
        assert h is not None
        assert await run_hunt(s, h, adapters, [channel]) == 1
        assert await run_hunt(s, h, adapters, [channel]) == 0  # nothing new, no duplicate
    assert [n.title for n in channel.sent] == ["Belas: Rick Owens Belas pants black"]
    assert channel.sent[0].url == "https://www.vinted.co.uk/items/3-x"

    matches = (await client.get(f"/api/hunts/{hunt_id}/matches")).json()
    assert {m["source_id"] for m in matches} == {"1", "3"}
    [hunt_out] = (await client.get("/api/hunts")).json()
    assert (hunt_out["match_count"], hunt_out["new_count"]) == (2, 1)

    # not due again for 30 minutes
    async with sessions() as s:
        assert await run_due_hunts(sessions, adapters, get_settings(), [channel]) == 0


async def test_failed_sends_release_the_key(sessions: async_sessionmaker[AsyncSession]) -> None:
    n = Notification("t", "b")
    async with sessions() as s:
        uid = await db_owner(s)
        await s.commit()
        fail = [FakeChannel(fail=True)]
        assert await notify_once(s, fail, user_id=uid, key="k1", kind="test", n=n) is False
        ok = FakeChannel()
        assert await notify_once(s, [ok], user_id=uid, key="k1", kind="test", n=n) is True
        assert await notify_once(s, [ok], user_id=uid, key="k1", kind="test", n=n) is False
        rows = (await s.execute(select(NotificationRow))).scalars().all()
        assert len(rows) == 1 and rows[0].channels == {"fake": "ok"}


async def test_price_drop_alerts(sessions: async_sessionmaker[AsyncSession]) -> None:
    adapter, channel = FakeAdapter(), FakeChannel()
    settings = Settings(
        rack_price_check_hours=6, rack_price_drop_min_pct=5, rack_price_drop_min_gbp=5
    )
    item = listing("9", "Lemaire overshirt", price="200")
    item.source, item.url = "grailed", "https://www.grailed.com/listings/9"
    async with sessions() as s:
        [lid] = await upsert_listings(s, [item])
        uid = await db_owner(s)
        s.add(SavedRow(user_id=uid, listing_id=lid, price_gbp_at_save=Decimal(200)))
        await s.commit()

    async def check(price: str | None, *, age_hours: int = 7) -> int:
        async with sessions() as s:
            from rack.models import ListingRow

            row = await s.get(ListingRow, lid)
            saved = await s.get(SavedRow, (uid, lid))
            assert row is not None and saved is not None
            row.last_seen_at = datetime.now(UTC) - timedelta(hours=age_hours)
            saved.price_checked_at = None
            await s.commit()
        adapter.current[item.url] = (
            None
            if price is None
            else item.model_copy(update={"price": Decimal(price), "price_gbp": Decimal(price)})
        )
        return await check_saved_prices(sessions, {"grailed": adapter}, settings, [channel])

    assert await check("198") == 0  # 1% isn't a drop
    assert await check("170") == 1
    assert channel.sent[-1].body == "£200 → £170 on grailed"
    assert await check("170") == 0  # already told you
    assert await check("150") == 1  # dropped again
    assert await check(None) == 0  # sold/gone: no alert, listing deactivated
