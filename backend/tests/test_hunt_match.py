"""ranking/hunt_match.py: "Size must match" (strict sizing) and size formats (feature 6)."""

from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import HuntRow, ListingRow
from rack.parsing.categories import shoe_sizes, size_matches
from rack.ranking.hunt_match import HuntSpec, hunt_matches
from rack.sources.base import Listing, SearchQuery
from rack.worker.hunts import run_hunt
from tests.conftest import login

H = {"X-Requested-With": "rack"}


def fits(size: str | None, sizes: list[str], *, strict: bool) -> bool:
    spec = HuntSpec(query="geobasket", sizes=sizes, strict_size=strict)
    return hunt_matches(
        spec, title="Rick Owens Geobasket", brand=None, description=None, price_gbp=None, size=size
    )


# --- the three cases the brief asks for ---


def test_missing_size_matches_only_when_not_strict() -> None:
    assert fits(None, ["9"], strict=False)
    assert fits("", ["9"], strict=False)
    assert not fits(None, ["9"], strict=True)
    assert not fits("", ["9"], strict=True)


@pytest.mark.parametrize(
    ("listing", "hunt"),
    [
        ("UK 9", "9"),
        ("9", "UK 9"),
        ("UK 9", "43"),
        ("43", "UK 9"),
        ("EU 43", "UK 9"),
        ("43", "9"),
        ("EU 42.5", "UK 9"),  # brands differ by half a size
        ("US 10", "UK 9"),
        ("W32 L34", "32"),
        ("m", "M"),
        ("XXL", "2XL"),
    ],
)
def test_matching_size_in_another_format(listing: str, hunt: str) -> None:
    assert fits(listing, [hunt], strict=True)
    assert fits(listing, ["L", hunt], strict=True)  # any of the hunt's sizes


@pytest.mark.parametrize(
    ("listing", "hunt"),
    [
        ("UK 10", "9"),
        ("EU 45", "UK 9"),
        ("UK 9.5", "UK 9"),  # same system: half sizes are different sizes
        ("L", "M"),
        ("W30 L34", "34"),  # the leg length is not a waist
        ("48", "UK 9"),  # an IT jacket size isn't near a UK 9 shoe
    ],
)
def test_non_matching_size_is_skipped_either_way(listing: str, hunt: str) -> None:
    assert not fits(listing, [hunt], strict=True)
    assert not fits(listing, [hunt], strict=False)  # a known mismatch always excludes


def test_strict_without_sizes_changes_nothing() -> None:
    assert fits(None, [], strict=True)


def test_shoe_readings() -> None:
    assert shoe_sizes("UK 9") == {("uk", 43.0)}
    assert shoe_sizes("EU 43") == {("eu", 43.0)}
    assert shoe_sizes("US 9.5") == {("uk", 42.5)}
    assert shoe_sizes("EU42 US9") == {("eu", 42.0), ("uk", 42.0)}
    assert shoe_sizes("M") == set() and shoe_sizes("W32") == set() and shoe_sizes("100") == set()
    assert size_matches(None, ["9"]) is None


# --- database / API ---


def vinted(sid: str, size: str | None) -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=f"Rick Owens Geobasket {sid}",
        price=Decimal("300"),
        currency="GBP",
        price_gbp=Decimal("300"),
        size=size,
    )


class FakeVinted:
    name = "vinted"

    def __init__(self) -> None:
        self.results: list[Listing] = []

    async def search(self, query: SearchQuery) -> list[Listing]:
        return list(self.results)

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return None


class Inbox:
    name = "fake"
    configured = True

    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send(self, n: object) -> None:
        self.sent.append(getattr(n, "title", ""))


@pytest.mark.db
async def test_strict_hunt_waits_for_the_size_then_alerts(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    adapter, inbox = FakeVinted(), Inbox()
    async with sessions() as s:
        hunt = HuntRow(
            name="Geo",
            query="geobasket",
            sources=["vinted"],
            sizes=["43"],
            strict_size=True,
            interval_minutes=30,
        )
        s.add(hunt)
        await s.commit()
        hunt_id = hunt.id

    async def run() -> int:
        async with sessions() as s:
            h = await s.get(HuntRow, hunt_id)
            assert h is not None
            return await run_hunt(s, h, {"vinted": adapter}, [inbox])

    adapter.results = []
    await run()  # silent baseline
    adapter.results = [vinted("1", None), vinted("2", "UK 9"), vinted("3", "UK 11")]
    assert await run() == 1
    assert inbox.sent == ["Geo: Rick Owens Geobasket 2"]

    # listing 1's size turns up later (e.g. an eBay item lookup): now it matches and alerts
    adapter.results = [vinted("1", "EU 43")]
    async with sessions() as s:
        from sqlalchemy import update

        await s.execute(update(ListingRow).where(ListingRow.source_id == "1").values(size=None))
        await s.commit()
    assert await run() == 1
    assert inbox.sent[-1] == "Geo: Rick Owens Geobasket 1"


@pytest.mark.db
async def test_api_round_trip(client: httpx.AsyncClient) -> None:
    await login(client)
    body = {"name": "Geo", "query": "geobasket", "sizes": ["43", "UK 9"], "strict_size": True}
    h = (await client.post("/api/hunts", json=body, headers=H)).json()
    assert h["strict_size"] is True and h["sizes"] == ["43", "UK 9"]
    # no sizes: strict can't stay on (nothing to match)
    h2 = (
        await client.put(
            f"/api/hunts/{h['id']}", json={**body, "sizes": [], "strict_size": True}, headers=H
        )
    ).json()
    assert h2["strict_size"] is False
    listed = (await client.get("/api/hunts")).json()
    assert listed[0]["strict_size"] is False
