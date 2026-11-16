from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api.gallery import get_fetchers
from rack.ingest import upsert_listings
from rack.sources.base import Listing, SourceError
from rack.sources.vinted import ItemDetails, parse_item_page
from tests.conftest import login

FIX = Path(__file__).parent / "fixtures" / "vinted" / "item_10761447613.html"


def test_vinted_item_page_has_all_photos_and_description() -> None:
    d = parse_item_page(FIX.read_text(encoding="utf-8"), "10761447613")
    assert len(d.images) == 7
    assert all("/f800/" in u for u in d.images)
    assert d.description and "EU42" in d.description
    assert (d.price, d.currency, d.available) == (Decimal("225"), "GBP", True)


class FakeFetcher:
    def __init__(self, details: ItemDetails | None = None, error: str | None = None) -> None:
        self.details, self.error, self.calls = details, error, 0

    async def item_details(self, url: str) -> ItemDetails:
        self.calls += 1
        if self.error:
            raise SourceError(self.error)
        assert self.details
        return self.details


def vinted_listing(images: list[str]) -> Listing:
    return Listing(
        source="vinted",
        source_id="555",
        url="https://www.vinted.co.uk/items/555-rick-owens-geobasket",
        title="Rick Owens geobasket",
        price=Decimal(300),
        currency="GBP",
        price_gbp=Decimal(310),
        images=images,
    )


def use(client: httpx.AsyncClient, fetcher: FakeFetcher) -> None:
    client._transport.app.dependency_overrides[get_fetchers] = lambda: {"vinted": fetcher}  # type: ignore[attr-defined]


@pytest.mark.db
async def test_gallery_fetches_once_and_survives_refresh(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    async with sessions() as s:
        [lid] = await upsert_listings(s, [vinted_listing(["https://img/1.jpg"])])
        await s.commit()
    fetcher = FakeFetcher(
        ItemDetails(
            images=["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg"],
            description="Inseam 90cm, worn twice",
            price=Decimal(300),
            currency="GBP",
            available=True,
        )
    )
    use(client, fetcher)

    g = (await client.get(f"/api/listings/{lid}/gallery")).json()
    assert g["images"] == ["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg"]
    assert g["description"] == "Inseam 90cm, worn twice"
    await client.get(f"/api/listings/{lid}/gallery")
    assert fetcher.calls == 1  # cached for a day

    # the next search refresh only knows the first photo and no description
    async with sessions() as s:
        await upsert_listings(s, [vinted_listing(["https://img/1.jpg"])])
        await s.commit()
    feed = (await client.get("/api/feed?sort=newest")).json()["items"]
    assert feed[0]["images"] == g["images"]
    g2 = (await client.get(f"/api/listings/{lid}/gallery")).json()
    assert g2["description"] == "Inseam 90cm, worn twice"


@pytest.mark.db
async def test_gallery_errors_and_sold_items(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    async with sessions() as s:
        [lid] = await upsert_listings(s, [vinted_listing(["https://img/1.jpg"])])
        await s.commit()
    use(client, FakeFetcher(error="Vinted item page failed: HTTP 403"))
    g = (await client.get(f"/api/listings/{lid}/gallery")).json()
    assert g["images"] == ["https://img/1.jpg"] and "403" in g["note"]

    use(client, FakeFetcher(ItemDetails([], None, None, None, available=False)))
    g = (await client.get(f"/api/listings/{lid}/gallery")).json()
    assert g["note"] == "This listing is no longer available."
    assert (await client.get("/api/feed?sort=newest")).json()["items"] == []
