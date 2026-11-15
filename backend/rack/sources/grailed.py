"""Grailed adapter via the Algolia search index that grailed.com's own frontend queries.

Checked live 2026-11-15: grailed.com itself returns a Cloudflare 403 to Rack, even in a headless
browser. The user chose to query Grailed's Algolia index directly instead, with the public
search-only key their website ships to every browser (found in the open-source
pznamir00/Grailed-API project).
Rack sends its honest User-Agent and no browser-impersonation headers. App id and key live in .env
so they can be updated if Grailed rotates them; a refused key shows up in source health.

Search only: the index has no item descriptions, and grailed.com item pages are blocked.
"""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from rack.pricing.fx import FALLBACK_TO_GBP, to_gbp
from rack.sources.base import (
    Category,
    Listing,
    SearchQuery,
    Seller,
    SourceError,
    SourceNotConfigured,
)
from rack.sources.http import RateLimitedClient

BASE = "https://www.grailed.com"
RELEVANCE_INDEX = "Listing_production"
NEWEST_INDEX = "Listing_by_date_added_production"

CATEGORY_FACETS: dict[Category, list[str]] = {
    Category.ANY: [],
    Category.TOPS: ["category:tops"],
    Category.TROUSERS: ["category:bottoms"],
    Category.SHOES: ["category:footwear"],
    Category.OUTERWEAR: ["category:outerwear", "category:tailoring"],
}
CONDITIONS = {
    "is_new": "New",
    "is_gently_used": "Gently used",
    "is_used": "Used",
    "is_worn": "Very worn",
    "is_not_specified": None,
}
COUNTRIES = {"United States": "US", "United Kingdom": "GB", "Canada": "CA"}


def _dec(v: Any) -> Decimal | None:
    try:
        return Decimal(str(v)) if v is not None else None
    except InvalidOperation:
        return None


def _dt(v: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else None
    except ValueError:
        return None


def parse_hit(hit: dict[str, Any]) -> Listing | None:
    price = _dec(hit.get("price"))
    if price is None or not hit.get("id") or not hit.get("title"):
        return None
    if hit.get("sold") or hit.get("deleted"):
        return None
    uk = (hit.get("shipping") or {}).get("uk") or {}
    if uk and uk.get("enabled") is False:
        return None  # seller doesn't ship to the UK

    photo = hit.get("cover_photo") or {}
    image = photo.get("url") or photo.get("image_url")
    user = hit.get("user") or {}
    score = user.get("seller_score") or {}
    rating = score.get("rating_average")
    designers = [d.get("name") for d in hit.get("designers") or [] if d.get("name")]

    return Listing(
        source="grailed",
        source_id=str(hit["id"]),
        url=f"{BASE}/listings/{hit['id']}",
        title=str(hit["title"]),
        brand=" × ".join(designers) or hit.get("designer_names"),
        price=price,
        currency="USD",
        price_gbp=to_gbp(price, "USD"),
        size=str(hit["size"]) if hit.get("size") is not None else None,
        condition=CONDITIONS.get(str(hit.get("condition"))),
        images=[image] if image else [],
        seller=Seller(
            name=user.get("username"),
            rating=float(rating) * 20 if rating is not None else None,
            count=score.get("rating_count"),
        ),
        listed_at=_dt(hit.get("created_at")),
        location=hit.get("location"),
        country=COUNTRIES.get(str(hit.get("location"))),
        shipping_cost=_dec(uk.get("amount")) if uk.get("enabled") else None,
        raw={k: v for k, v in hit.items() if not k.startswith("_")},
    )


def parse_results(payload: dict[str, Any]) -> list[Listing]:
    out: list[Listing] = []
    for hit in payload.get("hits") or []:
        listing = parse_hit(hit)
        if listing is not None:
            out.append(listing)
    return out


def build_body(query: SearchQuery) -> dict[str, Any]:
    facets: list[list[str]] = [["department:menswear"]]
    if CATEGORY_FACETS[query.category]:
        facets.append(CATEGORY_FACETS[query.category])
    body: dict[str, Any] = {
        "query": query.text,
        "hitsPerPage": min(query.limit, 100),
        "facetFilters": facets,
    }
    if query.max_price_gbp is not None:
        max_usd = int(query.max_price_gbp / FALLBACK_TO_GBP["USD"]) + 1
        body["numericFilters"] = [f"price_i<={max_usd}"]
    return body


class GrailedAdapter:
    name = "grailed"

    def __init__(
        self,
        app_id: str,
        api_key: str,
        *,
        min_interval: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._app = app_id
        self._key = api_key
        self._http = RateLimitedClient(min_interval, transport=transport)

    def _url(self, index: str) -> str:
        return f"https://{self._app.lower()}-dsn.algolia.net/1/indexes/{index}/query"

    async def fetch(self, query: SearchQuery) -> dict[str, Any]:
        if not (self._app and self._key):
            raise SourceNotConfigured("GRAILED_ALGOLIA_APP_ID / GRAILED_ALGOLIA_API_KEY not set")
        index = NEWEST_INDEX if query.newest_first else RELEVANCE_INDEX
        resp = await self._http.post(
            self._url(index),
            json=build_body(query),
            headers={"X-Algolia-Application-Id": self._app, "X-Algolia-API-Key": self._key},
        )
        if resp.status_code in (401, 403):
            raise SourceError(
                f"Grailed search key refused (HTTP {resp.status_code}); it may have been rotated"
            )
        if resp.status_code != 200:
            raise SourceError(f"Grailed search failed: HTTP {resp.status_code} {resp.text[:200]}")
        data: dict[str, Any] = resp.json()
        return data

    async def search(self, query: SearchQuery) -> list[Listing]:
        return parse_results(await self.fetch(query))

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return None  # grailed.com item pages are behind Cloudflare; search index only

    async def aclose(self) -> None:
        await self._http.aclose()
