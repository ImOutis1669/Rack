"""Grailed adapter via the Algolia search index that grailed.com's own frontend queries.

Checked live 2026-11-15: grailed.com itself returns a Cloudflare 403 to Rack, even in a headless
browser. The user chose to query Grailed's Algolia index directly instead, with the public
search-only key their website ships to every browser (found in the open-source
pznamir00/Grailed-API project).
Rack sends its honest User-Agent and no browser-impersonation headers. App id and key live in .env
so they can be updated if Grailed rotates them; a refused key shows up in source health.

Search only: the index has no item descriptions, and grailed.com item pages are blocked.

Sold prices (v1.1, user's choice 2026-11-16): the sold index `Listing_sold_production` (same key,
probed live) has `sold_price`, `sold_shipping_price` and `sold_at` per sale. Rack reads it for
wardrobe resale estimates and trends (pricing/resale.py, pricing/trend.py), keeping item data only:
`parse_sold` never reads the `user` (seller) object.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from rack.pricing.fx import current_rates, to_gbp
from rack.sources.base import (
    Category,
    Listing,
    SearchQuery,
    Seller,
    SourceError,
    SourceNotConfigured,
    build_listing,
)
from rack.sources.http import RateLimitedClient

BASE = "https://www.grailed.com"
RELEVANCE_INDEX = "Listing_production"
NEWEST_INDEX = "Listing_by_date_added_production"
SOLD_INDEX = "Listing_sold_production"

CATEGORY_FACETS: dict[Category, list[str]] = {
    Category.ANY: [],
    Category.TOPS: ["category:tops"],
    Category.TROUSERS: ["category:bottoms"],
    Category.SHOES: ["category:footwear"],
    Category.OUTERWEAR: ["category:outerwear", "category:tailoring"],
    # menswear facet (live 2026-11-17): hats, misc, bags_luggage, jewelry_watches, belts,
    # gloves_scarves; womenswear has its own womens_accessories / womens_jewelry.
    Category.ACCESSORIES: ["category:accessories"],
}
CONDITIONS = {
    "is_new": "New",
    "is_gently_used": "Gently used",
    "is_used": "Used",
    "is_worn": "Very worn",
    "is_not_specified": None,
}
# Grailed category -> Rack category (for sold comparables)
GRAILED_CATEGORIES: dict[str, Category] = {
    "tops": Category.TOPS,
    "bottoms": Category.TROUSERS,
    "footwear": Category.SHOES,
    "outerwear": Category.OUTERWEAR,
    "tailoring": Category.OUTERWEAR,
    "accessories": Category.ACCESSORIES,
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

    return build_listing(
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


@dataclass(frozen=True)
class SoldItem:
    source_id: str
    title: str
    brand: str | None
    category: Category
    size: str | None
    sold_price_gbp: Decimal
    shipping_gbp: Decimal | None
    sold_at: datetime
    image_url: str | None


def parse_sold(hit: dict[str, Any]) -> SoldItem | None:
    """A sale from the sold index, item fields only (never the `user`/seller object)."""
    price = _dec(hit.get("sold_price"))
    sold_at = _dt(hit.get("sold_at"))
    if not hit.get("sold") or price is None or price <= 0 or sold_at is None:
        return None
    if not hit.get("id") or not hit.get("title"):
        return None
    if str(hit.get("department") or "menswear") != "menswear":
        return None
    shipping = _dec(hit.get("sold_shipping_price"))
    if hit.get("sold_price_includes_shipping") and shipping is not None and shipping < price:
        price -= shipping  # compare item prices with item prices
    photo = hit.get("cover_photo") or {}
    image = photo.get("url") or photo.get("image_url")
    designers = [d.get("name") for d in hit.get("designers") or [] if d.get("name")]
    gbp = to_gbp(price, "USD")
    if gbp is None:
        return None
    return SoldItem(
        source_id=str(hit["id"]),
        title=str(hit["title"])[:500],
        brand=" × ".join(designers) or hit.get("designer_names"),
        category=GRAILED_CATEGORIES.get(str(hit.get("category")), Category.ANY),
        size=str(hit["size"])[:64] if hit.get("size") is not None else None,
        sold_price_gbp=gbp,
        shipping_gbp=to_gbp(shipping, "USD") if shipping is not None else None,
        sold_at=sold_at,
        image_url=str(image) if image and str(image).startswith("https://") else None,
    )


def build_sold_body(
    brand: str,
    category: Category,
    since: datetime,
    until: datetime,
    limit: int,
    words: Sequence[str] = (),
) -> dict[str, Any]:
    """Sales of `brand` between `since` and `until`. `words` (from the item's label) rank similar
    items first without being required (Algolia optionalWords)."""
    facets: list[list[str]] = [["department:menswear"]]
    if CATEGORY_FACETS[category]:
        facets.append(CATEGORY_FACETS[category])
    extra = [w for w in words if w.lower() not in brand.lower()]
    body: dict[str, Any] = {
        "query": " ".join([brand, *extra]),
        "hitsPerPage": min(limit, 200),
        "facetFilters": facets,
        "numericFilters": [
            f"sold_at_i>={int(since.timestamp())}",
            f"sold_at_i<{int(until.timestamp())}",
        ],
    }
    if extra:
        body["optionalWords"] = extra
    return body


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
        max_usd = int(query.max_price_gbp / current_rates()["USD"]) + 1
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

    async def search_sold(
        self,
        brand: str,
        category: Category,
        since: datetime,
        until: datetime,
        limit: int = 40,
        words: Sequence[str] = (),
    ) -> list[SoldItem]:
        """Sales of `brand` in one time slice (one request, through the shared rate limit)."""
        if not (self._app and self._key):
            raise SourceNotConfigured("GRAILED_ALGOLIA_APP_ID / GRAILED_ALGOLIA_API_KEY not set")
        resp = await self._http.post(
            self._url(SOLD_INDEX),
            json=build_sold_body(brand, category, since, until, limit, words),
            headers={"X-Algolia-Application-Id": self._app, "X-Algolia-API-Key": self._key},
        )
        if resp.status_code != 200:
            raise SourceError(f"Grailed sold search failed: HTTP {resp.status_code}")
        hits = resp.json().get("hits") or []
        return [s for s in (parse_sold(h) for h in hits) if s is not None]

    async def get_listing(self, url_or_id: str) -> Listing | None:
        """Current state of one listing, from the search index (grailed.com pages are blocked).

        None when it no longer exists, sold, or doesn't ship to the UK.
        """
        if not (self._app and self._key):
            raise SourceNotConfigured("GRAILED_ALGOLIA_APP_ID / GRAILED_ALGOLIA_API_KEY not set")
        listing_id = url_or_id.rstrip("/").rsplit("/", 1)[-1].split("-", 1)[0]
        resp = await self._http.get(
            f"https://{self._app.lower()}-dsn.algolia.net/1/indexes/{RELEVANCE_INDEX}/{listing_id}",
            headers={"X-Algolia-Application-Id": self._app, "X-Algolia-API-Key": self._key},
        )
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise SourceError(f"Grailed lookup failed: HTTP {resp.status_code}")
        data: dict[str, Any] = resp.json()
        return parse_hit(data)

    async def aclose(self) -> None:
        await self._http.aclose()
