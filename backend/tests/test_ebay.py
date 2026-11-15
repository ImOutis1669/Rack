import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from rack.sources.base import Category, SearchQuery, SourceError, SourceNotConfigured
from rack.sources.ebay import EbayAdapter, build_search_params, parse_search

FIXTURE = Path(__file__).parent / "fixtures" / "ebay" / "search_sample.json"


def load() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parse_search_normalises_items() -> None:
    listings = parse_search(load())
    assert len(listings) == 2  # broken item without price skipped

    gat = listings[0]
    assert gat.source == "ebay"
    assert gat.source_id == "v1|186712345678|0"
    assert gat.price == Decimal("185.00") and gat.currency == "GBP"
    assert gat.price_gbp == Decimal("185.00")
    assert gat.images[0].endswith("AAA/s-l1600.jpg") and len(gat.images) == 3
    assert gat.shipping_cost == Decimal("4.99")  # cheapest option
    assert gat.seller and gat.seller.rating == 99.6 and gat.seller.count == 1342
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
