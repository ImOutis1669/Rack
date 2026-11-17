""" "I bought it": saved listing -> wardrobe item, out of Saved/feed/hunts, and undo."""

from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api import purchases
from rack.embeddings.images import ImageError
from rack.ingest import upsert_listings
from rack.models import HuntRow, ListingRow, SavedRow, TasteItemRow
from rack.sources.base import Listing, SearchQuery, Seller
from rack.worker.hunts import run_hunt
from tests.conftest import db_owner, login
from tests.fakes import png

pytestmark = pytest.mark.db
H = {"X-Requested-With": "rack"}


def vinted(sid: str, title: str = "Rick Owens Geobasket black", price: str = "320") -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=title,
        brand="Rick Owens",
        price=Decimal(price),
        currency="GBP",
        price_gbp=Decimal(price),
        size="UK 9",
        images=[f"https://images1.vinted.net/t/{sid}/f800/a.jpeg"],
        seller=Seller(name="someone"),
    )


@pytest.fixture
def photos(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    asked: list[str] = []

    async def fake_download(url: str) -> bytes:
        asked.append(url)
        return png("black")

    monkeypatch.setattr(purchases, "download_photo", fake_download)
    return asked


async def _ingest(sessions: async_sessionmaker[AsyncSession], *items: Listing) -> list[int]:
    async with sessions() as s:
        ids = await upsert_listings(s, list(items))
        await s.commit()
    return ids


async def test_bought_moves_saved_listing_into_the_wardrobe(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    photos: list[str],
    tmp_path: Path,
) -> None:
    await login(client)
    [lid] = await _ingest(sessions, vinted("1"))
    assert (await client.put(f"/api/listings/{lid}/saved", headers=H)).status_code == 204
    version = (await client.get("/api/profile")).json()["version"]

    r = await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "300"}, headers=H)
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["kind"] == "wardrobe" and item["text"] == "Rick Owens Geobasket black"
    assert (item["source"], item["brand"], item["size"]) == ("vinted", "Rick Owens", "UK 9")
    assert item["listing_url"] == "https://www.vinted.co.uk/items/1-x"
    assert Decimal(item["purchase_price_gbp"]) == Decimal("300")
    assert item["image"] and not item["photo_missing"] and item["purchased_at"]
    assert photos == ["https://images1.vinted.net/t/1/f800/a.jpeg"]
    assert len([p for p in (tmp_path / "data" / "uploads").rglob("*") if p.is_file()]) == 1
    # shapes the feed: the profile version moved, so the worker embeds it and rescores
    assert (await client.get("/api/profile")).json()["version"] > version

    # out of Saved (so no more price-drop checks), out of the feed, listing kept
    assert (await client.get("/api/saved")).json() == []
    assert lid not in [i["id"] for i in (await client.get("/api/feed?sort=newest")).json()["items"]]
    async with sessions() as s:
        assert await s.get(SavedRow, (await db_owner(s), lid)) is None
        assert await s.get(ListingRow, lid) is not None

    wardrobe = (await client.get("/api/taste?kind=wardrobe")).json()
    assert [w["id"] for w in wardrobe] == [item["id"]]

    again = await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "1"}, headers=H)
    assert again.status_code == 409


async def test_undo_puts_it_back_in_saved_exactly(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    photos: list[str],
    tmp_path: Path,
) -> None:
    await login(client)
    [lid] = await _ingest(sessions, vinted("2"))
    await client.put(f"/api/listings/{lid}/saved", headers=H)
    async with sessions() as s:
        before = await s.get(SavedRow, (await db_owner(s), lid))
        assert before is not None
        before.last_alert_price_gbp = Decimal("310")
        await s.commit()
        snapshot = (before.saved_at, before.price_gbp_at_save, before.last_alert_price_gbp)

    item = (
        await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "290.50"}, headers=H)
    ).json()
    r = await client.post(f"/api/taste/{item['id']}/undo-bought", headers=H)
    assert r.json() == {"restored_to_saved": True}
    async with sessions() as s:
        after = await s.get(SavedRow, (await db_owner(s), lid))
        assert after is not None
        assert (after.saved_at, after.price_gbp_at_save, after.last_alert_price_gbp) == snapshot
        assert (await s.execute(select(TasteItemRow))).first() is None
    assert [p for p in (tmp_path / "data" / "uploads").rglob("*") if p.is_file()] == []
    assert lid in [i["id"] for i in (await client.get("/api/saved")).json()]


async def test_removing_from_wardrobe_keeps_the_listing(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], photos: list[str]
) -> None:
    await login(client)
    [lid] = await _ingest(sessions, vinted("3"))
    item = (
        await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "10"}, headers=H)
    ).json()
    assert (await client.delete(f"/api/taste/{item['id']}", headers=H)).status_code == 204
    async with sessions() as s:
        assert await s.get(ListingRow, lid) is not None
    # nothing to restore once it's gone from the wardrobe
    assert (await client.post(f"/api/taste/{item['id']}/undo-bought", headers=H)).status_code == 404


async def test_photo_failure_still_adds_it_with_the_title(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def broken(url: str) -> bytes:
        raise ImageError("image fetch HTTP 404")

    monkeypatch.setattr(purchases, "download_photo", broken)
    await login(client)
    [lid] = await _ingest(sessions, vinted("4"))
    item = (
        await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "50"}, headers=H)
    ).json()
    assert item["photo_missing"] and item["image"] is None
    assert item["text"] == "Rick Owens Geobasket black"


async def test_rejects_bad_prices_and_unknown_listings(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], photos: list[str]
) -> None:
    await login(client)
    [lid] = await _ingest(sessions, vinted("5"))
    for bad in ("-1", "100001", "abc", "1.234"):
        r = await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": bad}, headers=H)
        assert r.status_code == 422, bad
    r = await client.post("/api/listings/999999/bought", json={"price_gbp": "1"}, headers=H)
    assert r.status_code == 404


async def test_photo_download_only_from_marketplace_hosts() -> None:
    with pytest.raises(ImageError):
        await purchases.download_photo("https://evil.example/a.jpg")
    with pytest.raises(ImageError):
        await purchases.download_photo("http://images1.vinted.net/a.jpg")  # not https


async def test_bought_ebay_listing_stores_no_seller_data(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], photos: list[str]
) -> None:
    await login(client)
    ebay = Listing(
        source="ebay",
        source_id="v1|1|0",
        url="https://www.ebay.co.uk/itm/1",
        title="Margiela GAT",
        price=Decimal("150"),
        currency="GBP",
        price_gbp=Decimal("150"),
        images=["https://i.ebayimg.com/images/g/AAA/s-l1600.jpg"],
        seller=Seller(name="example_seller_one"),
    )
    [lid] = await _ingest(sessions, ebay)
    item = (
        await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "150"}, headers=H)
    ).json()
    assert "example_seller_one" not in str(item)
    async with sessions() as s:
        row = await s.get(TasteItemRow, item["id"])
        assert row is not None and row.source == "ebay"


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


async def test_hunts_never_alert_on_something_you_bought(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], photos: list[str]
) -> None:
    await login(client)
    adapter, inbox = FakeVinted(), Inbox()
    async with sessions() as s:
        hunt = HuntRow(
            user_id=await db_owner(s),
            name="Geo",
            query="geobasket",
            sources=["vinted"],
            interval_minutes=30,
        )
        s.add(hunt)
        await s.commit()
        hunt_id = hunt.id
    adapter.results = [vinted("10")]
    async with sessions() as s:
        h = await s.get(HuntRow, hunt_id)
        assert h is not None
        await run_hunt(s, h, {"vinted": adapter}, [inbox])  # silent baseline

    [bought_id] = await _ingest(sessions, vinted("11"))
    await client.post(f"/api/listings/{bought_id}/bought", json={"price_gbp": "1"}, headers=H)
    adapter.results = [vinted("10"), vinted("11"), vinted("12", "Geobasket white")]
    async with sessions() as s:
        h = await s.get(HuntRow, hunt_id)
        assert h is not None
        assert await run_hunt(s, h, {"vinted": adapter}, [inbox]) == 1
    assert inbox.sent == ["Geo: Geobasket white"]
