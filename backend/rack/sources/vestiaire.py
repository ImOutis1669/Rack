"""Vestiaire Collective via a paid Apify actor (residential proxies), chosen by the user.

vestiairecollective.com answers Rack — even from a residential home connection — with a Cloudflare
Turnstile "verify you are human" page, so Rack can't fetch it itself. The user opted to pay for
the community actor `b2b_leads/vestiaire-collective-real-time-data-scraper`, which runs on Apify's
residential proxy pool. Rack only calls Apify's API with the user's token.

Cost: the actor bills per result (~$25 / 1,000 at time of writing; free Apify plans return 2 results
per run). Rack therefore runs it on its own slow schedule with per-run and monthly result caps
(see config `vestiaire_*`), never in the 30-minute refresh.

Field names follow the actor's documented output; the fixture is hand-built from that
documentation until a live run is recorded with `rack probe vestiaire "…" --record`.
"""

from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from rack.pricing.fx import to_gbp
from rack.sources.base import Listing, SearchQuery, Seller, SourceError, SourceNotConfigured
from rack.sources.http import RateLimitedClient

ACTOR = "b2b_leads~vestiaire-collective-real-time-data-scraper"
RUN_URL = f"https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items"
BASE = "https://www.vestiairecollective.com"


def _dec(v: Any) -> Decimal | None:
    try:
        return Decimal(str(v)) if v not in (None, "") else None
    except InvalidOperation:
        return None


def build_input(query: SearchQuery, max_results: int, enrich: bool) -> dict[str, Any]:
    body: dict[str, Any] = {
        "enableListingSearch": True,
        "searchKeywords": [query.text],
        "searchMaxResults": max(1, min(max_results, 200)),
        "searchSort": "newest" if query.newest_first else "relevance",
        "searchFetchFullDetails": enrich,
        "country": "UK",
        "proxyConfiguration": {
            "useApifyProxy": True,
            "apifyProxyGroups": ["RESIDENTIAL"],
            "apifyProxyCountry": "GB",
        },
    }
    if query.max_price_gbp is not None:
        body["searchMaxPrice"] = int(query.max_price_gbp)
    return body


def parse_item(d: dict[str, Any]) -> Listing | None:
    item_id = d.get("item_id")
    price = _dec(d.get("current_price"))
    currency = str(d.get("currency") or "").upper()
    if not item_id or price is None or not currency or not d.get("title"):
        return None
    if d.get("is_sold") or str(d.get("status") or "").lower() == "sold":
        return None
    if "women" in str(d.get("department") or "").lower():
        return None  # same men's-only scope as the other sources
    images = [u for u in [d.get("main_image_url"), *(d.get("additional_image_urls") or [])] if u]
    url = d.get("item_url") or d.get("url") or ""
    return Listing(
        source="vestiaire",
        source_id=str(item_id),
        url=url if str(url).startswith("http") else f"{BASE}{url}",
        title=str(d["title"]),
        description=d.get("description"),
        brand=d.get("brand"),
        price=price,
        currency=currency,
        price_gbp=to_gbp(price, currency),
        size=str(d["size"]) if d.get("size") else None,
        condition=d.get("condition"),
        images=list(dict.fromkeys(images)),
        seller=Seller(name=d.get("seller_username")) if d.get("seller_username") else None,
        location=d.get("seller_location"),
        raw=d,
    )


def parse_items(rows: list[dict[str, Any]]) -> list[Listing]:
    """Rows stream in twice when enrichment is on: keep the last row per item_id."""
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        kind = row.get("featureType", "listing_search")
        if kind in ("listing_search", "listing_details") and row.get("item_id"):
            latest[str(row["item_id"])] = row
    out: list[Listing] = []
    for row in latest.values():
        listing = parse_item(row)
        if listing is not None:
            out.append(listing)
    return out


class VestiaireApifyAdapter:
    name = "vestiaire"

    def __init__(
        self,
        token: str,
        *,
        max_results: int = 10,
        enrich: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token
        self.max_results = max_results
        self._enrich = enrich
        # A run takes a while; Apify keeps run-sync requests open for up to 300 s.
        self._http = RateLimitedClient(1.0, timeout=330.0, max_retries=1, transport=transport)

    async def run_actor(self, query: SearchQuery) -> list[dict[str, Any]]:
        if not self._token:
            raise SourceNotConfigured(
                "APIFY_TOKEN not set (Vestiaire runs through a paid Apify actor)"
            )
        resp = await self._http.post(
            RUN_URL,
            json=build_input(query, self.max_results, self._enrich),
            headers={"Authorization": f"Bearer {self._token}"},
        )
        if resp.status_code == 401:
            raise SourceError("Apify refused the token (HTTP 401)")
        if resp.status_code == 402:
            raise SourceError("Apify says payment is required (out of credit or plan limit)")
        if resp.status_code == 408:
            raise SourceError("Apify actor run timed out")
        if resp.status_code not in (200, 201):
            raise SourceError(f"Apify actor failed: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        if not isinstance(data, list):
            raise SourceError("Apify returned something other than a list of items")
        return [row for row in data if isinstance(row, dict)]

    async def search(self, query: SearchQuery) -> list[Listing]:
        return parse_items(await self.run_actor(query))

    async def get_listing(self, url_or_id: str) -> Listing | None:
        return None

    async def aclose(self) -> None:
        await self._http.aclose()
