import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from rack.sources.base import Category, SearchQuery, SourceError, SourceNotConfigured
from rack.sources.ebay import (
    EbayAdapter,
    build_search_params,
    full_size_image,
    is_womens,
    parse_item,
    parse_search,
    quota_day,
)

FIXTURE = Path(__file__).parent / "fixtures" / "ebay" / "search_sample.json"


def load() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parse_search_normalises_items() -> None:
    listings = parse_search(load())
    assert len(listings) == 2  # women's item and the auction without a price skipped

    gat = listings[0]
    assert gat.source == "ebay"
    assert gat.source_id == "v1|186712345678|0"
    assert gat.price == Decimal("185.00") and gat.currency == "GBP"
    assert gat.price_gbp == Decimal("185.00")
    assert gat.images[0].endswith("AAA/s-l1600.jpg") and len(gat.images) == 3
    assert gat.shipping_cost == Decimal("4.99")  # cheapest option
    assert gat.seller is None and gat.location is None  # no eBay user data (test_ebay_privacy)
    assert gat.country == "GB"
    assert gat.listed_at and gat.listed_at.tzinfo is not None
    assert gat.url == "https://www.ebay.co.uk/itm/186712345678"


def test_parse_converts_foreign_currency() -> None:
    tee = parse_search(load())[1]
    assert tee.currency == "USD" and tee.country == "US"
    assert tee.price_gbp is not None and Decimal("80") < tee.price_gbp < Decimal("110")


def test_build_search_params() -> None:
    params = build_search_params(
        SearchQuery(text="geobasket", category=Category.SHOES, max_price_gbp=Decimal("400"))
    )
    assert params["q"] == "geobasket"
    assert params["category_ids"] == "93427"
    assert "price:[..400]" in params["filter"] and "priceCurrency:GBP" in params["filter"]
    assert params["sort"] == "newlyListed"


async def test_unconfigured_adapter_raises_not_configured() -> None:
    adapter = EbayAdapter("", "")
    with pytest.raises(SourceNotConfigured):
        await adapter.search(SearchQuery(text="x"))
    await adapter.aclose()


async def test_search_with_mock_transport() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
        assert request.headers["Authorization"] == "Bearer tok"
        assert request.headers["X-EBAY-C-MARKETPLACE-ID"] == "EBAY_GB"
        return httpx.Response(200, json=load())

    adapter = EbayAdapter("id", "secret", min_interval=0, transport=httpx.MockTransport(handler))
    results = await adapter.search(SearchQuery(text="margiela"))
    assert len(results) == 2
    await adapter.search(SearchQuery(text="margiela"))
    assert sum(1 for c in calls if c.url.path.endswith("/oauth2/token")) == 1  # token cached
    await adapter.aclose()


async def test_search_error_raises_source_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
        return httpx.Response(400, json={"errors": [{"message": "bad"}]})

    adapter = EbayAdapter("id", "secret", min_interval=0, transport=httpx.MockTransport(handler))
    with pytest.raises(SourceError):
        await adapter.search(SearchQuery(text="x"))
    await adapter.aclose()


ITEM = Path(__file__).parent / "fixtures" / "ebay" / "item_sample.json"


def load_item() -> dict:
    return json.loads(ITEM.read_text(encoding="utf-8"))


def test_search_only_returns_items_that_deliver_to_the_uk() -> None:
    assert "deliveryCountry:GB" in build_search_params(SearchQuery(text="x"))["filter"]


def test_womens_items_are_skipped() -> None:
    titles = [x.title for x in parse_search(load())]
    assert not any("Women" in t for t in titles)
    item = load_item()
    assert not is_womens(item)
    assert is_womens({**item, "categoryPath": "Clothes, Shoes & Accessories|Women|Women's Shoes"})
    assert is_womens(
        {**item, "categoryPath": "", "localizedAspects": [{"name": "Department", "value": "Women"}]}
    )
    assert not is_womens({**item, "localizedAspects": [{"name": "Department", "value": "Unisex"}]})


def test_search_summaries_take_size_from_the_title() -> None:
    gat, tee = parse_search(load())
    assert gat.size == "EU 46" and tee.size == "L"
    assert gat.brand is None  # summaries have no brand: getItem fills it in


def test_get_item_adds_size_brand_and_short_description_only() -> None:
    listing = parse_item(load_item())
    assert listing is not None
    assert listing.brand == "Maison Margiela" and listing.size == "12"
    assert listing.description == "Worn a handful of times, original box."  # not seller HTML
    assert len(listing.images) == 4 and listing.seller is None and listing.location is None
    assert "description" not in listing.raw and "seller" not in listing.raw


def test_shoe_size_aspect_when_there_is_no_size_field() -> None:
    item = {k: v for k, v in load_item().items() if k != "size"}
    assert (listing := parse_item(item)) is not None and listing.size == "12"


async def test_counts_calls_per_ebay_day() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
        if "/item/" in request.url.path:
            return httpx.Response(200, json=load_item())
        return httpx.Response(200, json=load())

    adapter = EbayAdapter("id", "secret", min_interval=0, transport=httpx.MockTransport(handler))
    await adapter.search(SearchQuery(text="a"))
    await adapter.search(SearchQuery(text="b"))
    assert (item := await adapter.fetch_item("v1|186712345678|0")) is not None
    assert item["brand"] == "Maison Margiela"
    assert (adapter.calls_today("token"), adapter.calls_today("search")) == (1, 2)
    assert adapter.calls_today("item") == 1
    await adapter.aclose()

    other = EbayAdapter("id", "secret")
    other.restore_usage(dict(adapter.usage))
    assert other.calls_today("search") == 2
    other.restore_usage({"day": "2020-01-01", "search": 99})  # an old day is ignored
    assert other.calls_today("search") == 2
    await other.aclose()


def test_quota_day_resets_at_midnight_pacific() -> None:
    assert quota_day(datetime(2026, 11, 17, 7, 59, tzinfo=UTC)) == "2026-11-16"
    assert quota_day(datetime(2026, 11, 17, 8, 0, tzinfo=UTC)) == "2026-11-17"


G = "https://i.ebayimg.com/images/g"


def test_full_size_image_uses_the_getitem_variant() -> None:
    assert full_size_image(f"{G}/abc/s-l225.jpg") == f"{G}/abc/s-l1600.jpg"
    assert full_size_image(f"{G}/abc/s-l500.PNG") == f"{G}/abc/s-l1600.PNG"
    assert full_size_image(f"{G}/abc/s-l1600.jpg") == f"{G}/abc/s-l1600.jpg"
    other = "https://i.vendoo.co/i/x/y.jpeg?vs=8160,8160"
    assert full_size_image(other) == other


def test_search_summaries_store_full_size_photos_once() -> None:
    summary = {
        "itemId": "v1|1|0",
        "title": "Leather jacket",
        "itemWebUrl": "https://www.ebay.co.uk/itm/1",
        "price": {"value": "10.00", "currency": "GBP"},
        "image": {"imageUrl": f"{G}/abc/s-l225.jpg"},
        "additionalImages": [
            {"imageUrl": f"{G}/def/s-l225.jpg"},
            {"imageUrl": f"{G}/abc/s-l1600.jpg"},  # the same photo again, at another size
        ],
    }
    listing = parse_item(summary)
    assert listing is not None
    assert listing.images == [f"{G}/abc/s-l1600.jpg", f"{G}/def/s-l1600.jpg"]
