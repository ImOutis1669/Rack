"""eBay UK adapter via the official Browse API (reference adapter).

Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
Auth: OAuth client-credentials grant, scope https://api.ebay.com/oauth/api_scope.

Privacy: the user registered for eBay's Marketplace Account Deletion exemption ("I do not persist
eBay data"). So no eBay user data is ever parsed or stored: no seller username, feedback, or item
city/postcode, and `raw` keeps only the allow-listed item fields below. `ingest.py` re-checks this,
and the worker deletes eBay listings that are inactive or unseen for RACK_EBAY_RETENTION_DAYS.
"""

import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from rack.pricing.fx import to_gbp
from rack.sources.base import (
    Category,
    Listing,
    SearchQuery,
    SourceError,
    SourceNotConfigured,
    build_listing,
)
from rack.sources.http import RateLimitedClient

API = "https://api.ebay.com"
TOKEN_URL = f"{API}/identity/v1/oauth2/token"
SEARCH_URL = f"{API}/buy/browse/v1/item_summary/search"
ITEM_URL = f"{API}/buy/browse/v1/item"
SCOPE = "https://api.ebay.com/oauth/api_scope"

# EBAY_GB category ids. TODO(phase 2): make gender/department configurable in the profile.
CATEGORY_IDS: dict[Category, str] = {
    Category.ANY: "11450",  # Clothes, Shoes & Accessories
    Category.TOPS: "1059",  # Men's Clothing
    Category.TROUSERS: "57989",  # Men's Trousers
    Category.SHOES: "93427",  # Men's Shoes
    Category.OUTERWEAR: "57988",  # Men's Coats, Jackets & Waistcoats
}

# Item fields kept in `raw` (also all a recorded fixture contains). Nothing about the seller.
RAW_KEYS = (
    "itemId",
    "title",
    "shortDescription",
    "price",
    "image",
    "additionalImages",
    "size",
    "condition",
    "itemWebUrl",
    "brand",
    "itemCreationDate",
)
RAW_ASPECTS = ("brand", "size")

LEGACY_ID_RE = re.compile(r"/itm/(?:[^/]+/)?(\d{9,15})")


def _dec(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value)) if value is not None else None
    except InvalidOperation:
        return None


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _aspect(item: dict[str, Any], name: str) -> str | None:
    for a in item.get("localizedAspects") or []:
        if str(a.get("name", "")).lower() == name.lower():
            return str(a.get("value"))
    return None


def safe_raw(item: dict[str, Any]) -> dict[str, Any]:
    """The item minus every field that isn't plain item data (seller, location, buyer...)."""
    out = {k: item[k] for k in RAW_KEYS if k in item}
    aspects = [
        {"name": a.get("name"), "value": a.get("value")}
        for a in item.get("localizedAspects") or []
        if str(a.get("name", "")).lower() in RAW_ASPECTS
    ]
    if aspects:
        out["localizedAspects"] = aspects
    shipping = [
        {"shippingCost": o["shippingCost"]}
        for o in item.get("shippingOptions") or []
        if isinstance(o.get("shippingCost"), dict)
    ]
    if shipping:
        out["shippingOptions"] = shipping
    country = (item.get("itemLocation") or {}).get("country")
    if country:
        out["itemLocation"] = {"country": country}
    return out


def parse_item(item: dict[str, Any]) -> Listing | None:
    """Parse an itemSummary (search) or item (getItem) object into a Listing."""
    price = item.get("price") or {}
    amount = _dec(price.get("value"))
    currency = price.get("currency")
    if amount is None or not currency or not item.get("itemId"):
        return None

    images: list[str] = []
    if (img := item.get("image")) and img.get("imageUrl"):
        images.append(img["imageUrl"])
    for extra in item.get("additionalImages") or []:
        if extra.get("imageUrl") and extra["imageUrl"] not in images:
            images.append(extra["imageUrl"])

    shipping: Decimal | None = None
    for opt in item.get("shippingOptions") or []:
        cost = opt.get("shippingCost") or {}
        val = _dec(cost.get("value"))
        if val is not None and cost.get("currency") == currency:
            shipping = val if shipping is None else min(shipping, val)

    # country only (landed cost needs it); city/postcode can identify a private seller
    country = (item.get("itemLocation") or {}).get("country")

    return build_listing(
        source="ebay",
        source_id=item["itemId"],
        url=item.get("itemWebUrl") or "",
        title=item.get("title", ""),
        description=item.get("shortDescription") or item.get("description"),
        brand=item.get("brand") or _aspect(item, "Brand"),
        price=amount,
        currency=currency,
        price_gbp=to_gbp(amount, currency),
        size=item.get("size") or _aspect(item, "Size"),
        condition=item.get("condition"),
        images=images,
        seller=None,
        listed_at=_dt(item.get("itemCreationDate")),
        location=None,
        country=country,
        shipping_cost=shipping,
        raw=safe_raw(item),
    )


def parse_search(payload: dict[str, Any]) -> list[Listing]:
    out: list[Listing] = []
    for item in payload.get("itemSummaries") or []:
        listing = parse_item(item)
        if listing is not None:
            out.append(listing)
    return out


def build_search_params(query: SearchQuery) -> dict[str, str]:
    filters = ["buyingOptions:{FIXED_PRICE|BEST_OFFER}"]
    if query.max_price_gbp is not None:
        filters.append(f"price:[..{query.max_price_gbp}]")
        filters.append("priceCurrency:GBP")
    params = {
        "q": query.text,
        "limit": str(min(query.limit, 200)),
        "category_ids": CATEGORY_IDS[query.category],
        "filter": ",".join(filters),
    }
    if query.newest_first:
        params["sort"] = "newlyListed"
    return params


class EbayAdapter:
    name = "ebay"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        marketplace: str = "EBAY_GB",
        min_interval: float = 2.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._id = client_id
        self._secret = client_secret
        self._marketplace = marketplace
        self._http = RateLimitedClient(min_interval, transport=transport)
        self._token: str | None = None
        self._token_exp = 0.0

    @property
    def configured(self) -> bool:
        return bool(self._id and self._secret)

    async def _auth_headers(self) -> dict[str, str]:
        if not self.configured:
            raise SourceNotConfigured("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set")
        if self._token is None or time.time() > self._token_exp - 60:
            resp = await self._http.post(
                TOKEN_URL,
                auth=(self._id, self._secret),
                data={"grant_type": "client_credentials", "scope": SCOPE},
            )
            if resp.status_code != 200:
                raise SourceError(
                    f"eBay token request failed: {resp.status_code} {resp.text[:200]}"
                )
            body = resp.json()
            self._token = body["access_token"]
            self._token_exp = time.time() + float(body.get("expires_in", 7200))
        return {
            "Authorization": f"Bearer {self._token}",
            "X-EBAY-C-MARKETPLACE-ID": self._marketplace,
        }

    async def search(self, query: SearchQuery) -> list[Listing]:
        headers = await self._auth_headers()
        resp = await self._http.get(SEARCH_URL, params=build_search_params(query), headers=headers)
        if resp.status_code != 200:
            raise SourceError(f"eBay search failed: {resp.status_code} {resp.text[:200]}")
        return parse_search(resp.json())

    async def get_listing(self, url_or_id: str) -> Listing | None:
        headers = await self._auth_headers()
        if m := LEGACY_ID_RE.search(url_or_id):
            resp = await self._http.get(
                f"{ITEM_URL}/get_item_by_legacy_id",
                params={"legacy_item_id": m.group(1)},
                headers=headers,
            )
        else:
            resp = await self._http.get(f"{ITEM_URL}/{url_or_id}", headers=headers)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise SourceError(f"eBay getItem failed: {resp.status_code} {resp.text[:200]}")
        return parse_item(resp.json())

    async def aclose(self) -> None:
        await self._http.aclose()
