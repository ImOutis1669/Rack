import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from rack.sources import grailed, vinted
from rack.sources.base import Category, SearchQuery, SourceError, SourceNotConfigured
from rack.sources.http import USER_AGENT

FIX = Path(__file__).parent / "fixtures"
VINTED_HTML = (FIX / "vinted" / "search_rick_owens.html").read_text(encoding="utf-8")
GRAILED_JSON = json.loads((FIX / "grailed" / "search_rick_owens.json").read_text(encoding="utf-8"))


async def _nosleep(_: float) -> None:
    return None


# --- Vinted ---


def test_vinted_parses_recorded_page() -> None:
    items = vinted.parse_page(VINTED_HTML)
    assert len(items) == 96
    first = items[0]
    assert first.source == "vinted" and first.country == "GB"
    assert first.url.startswith("https://www.vinted.co.uk/items/")
    assert all(i.price_gbp is not None and i.price_gbp >= i.price for i in items)  # incl. fee
    assert sum(1 for i in items if i.brand) > 80
    assert sum(1 for i in items if i.size) > 80
    assert any(i.brand == "Rick Owens" for i in items)
    assert all(i.images for i in items)


def test_vinted_price_includes_buyer_protection() -> None:
    lev = next(i for i in vinted.parse_page(VINTED_HTML) if i.source_id == "10832736494")
    assert lev.price == Decimal("62.00") and lev.price_gbp == Decimal("65.80")
    assert (lev.brand, lev.size, lev.condition) == ("Levi's", "W31", "Very good")


def test_vinted_rejects_non_next_pages() -> None:
    with pytest.raises(SourceError):
        vinted.parse_page("<html><title>Just a moment...</title></html>")


def test_vinted_search_params_use_mens_catalogue() -> None:
    q = SearchQuery(text="rick owens", category=Category.TROUSERS, max_price_gbp=Decimal(200))
    params = vinted.build_search_params(q)
    assert ("catalog[]", "34") in params and ("catalog[]", "257") in params
    assert ("price_to", "200") in params and ("order", "newest_first") in params


async def test_vinted_adapter_reports_blocks() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["user-agent"] == USER_AGENT
        return httpx.Response(403, text="blocked")

    a = vinted.VintedAdapter(min_interval=0, transport=httpx.MockTransport(handler))
    a._http._sleep = _nosleep
    with pytest.raises(SourceError, match="403"):
        await a.search(SearchQuery(text="x"))
    await a.aclose()


# --- Grailed ---


def test_grailed_parses_recorded_hits() -> None:
    items = grailed.parse_results(GRAILED_JSON)
    assert len(items) == 84  # 16 hits don't ship to the UK
    i = items[0]
    assert i.source == "grailed" and i.currency == "USD"
    assert i.url == f"https://www.grailed.com/listings/{i.source_id}"
    assert i.price_gbp == (i.price * Decimal("0.77")).quantize(Decimal("0.01"))
    assert all(x.shipping_cost is not None for x in items)
    assert {x.condition for x in items} <= {"New", "Gently used", "Used", "Very worn", None}
    assert all(x.seller and (x.seller.rating is None or 0 <= x.seller.rating <= 100) for x in items)


def test_grailed_body() -> None:
    body = grailed.build_body(
        SearchQuery(text="lemaire", category=Category.OUTERWEAR, max_price_gbp=Decimal(77))
    )
    assert body["facetFilters"] == [
        ["department:menswear"],
        ["category:outerwear", "category:tailoring"],
    ]
    assert body["numericFilters"] == ["price_i<=101"]


async def test_grailed_honest_headers_and_key_errors() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(403, json={"message": "Invalid API key"})

    a = grailed.GrailedAdapter("APP", "KEY", min_interval=0, transport=httpx.MockTransport(handler))
    a._http._sleep = _nosleep
    with pytest.raises(SourceError, match="rotated"):
        await a.search(SearchQuery(text="x"))
    req = seen[0]
    assert req.headers["user-agent"] == USER_AGENT
    assert "sec-ch-ua" not in req.headers
    assert req.url.path.endswith("/Listing_by_date_added_production/query")
    await a.aclose()

    with pytest.raises(SourceNotConfigured):
        await grailed.GrailedAdapter("", "").search(SearchQuery(text="x"))
