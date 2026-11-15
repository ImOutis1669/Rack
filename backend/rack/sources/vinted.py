"""Vinted UK adapter: reads the public catalog search page (no login, no API keys).

Checked live 2026-11-15: the old JSON endpoint `/api/v2/catalog/items` returns 404, but the server-
rendered search page `/catalog?search_text=…` embeds every result as a `productItem` object in the
Next.js flight data (`self.__next_f.push([1, "…"])` script chunks). One page request per query.

Unofficial access: this may break Vinted's terms and can stop working at any time (DataDome bot
protection is present). Volume is kept very low; a block is reported in source health, never evaded.
"""

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from rack.pricing.fx import to_gbp
from rack.sources.base import Category, Listing, SearchQuery, Seller, SourceError
from rack.sources.http import RateLimitedClient

BASE = "https://www.vinted.co.uk"
CATALOG_URL = f"{BASE}/catalog"

# Men's catalogue ids, taken from the category tree embedded in the live page (2026-11-15).
# Same men's-only scope as the eBay adapter.
CATALOG_IDS: dict[Category, list[int]] = {
    Category.ANY: [5],  # Men
    Category.TOPS: [76, 79],  # Tops & t-shirts, Jumpers & sweaters
    Category.TROUSERS: [34, 257],  # Trousers, Jeans
    Category.SHOES: [1231],  # Shoes
    Category.OUTERWEAR: [1206, 32],  # Outerwear, Suits & blazers
}

FLIGHT_CHUNK = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')
LABEL_FIELD = re.compile(r"(Brand|Condition|Size): ([^,]+)")
ITEM_ID = re.compile(r"/items/(\d+)")


def _dec(v: Any) -> Decimal | None:
    try:
        return Decimal(str(v)) if v is not None else None
    except InvalidOperation:
        return None


def flight_text(html: str) -> str:
    """Concatenate the decoded flight-data chunks of a Next.js page."""
    return "".join(json.loads(c) for c in FLIGHT_CHUNK.findall(html))


def product_items(flight: str) -> list[dict[str, Any]]:
    dec = json.JSONDecoder()
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for m in re.finditer(r'"productItem":\s*', flight):
        try:
            obj, _ = dec.raw_decode(flight, m.end())
        except ValueError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("id"), int) and obj["id"] not in seen:
            seen.add(obj["id"])
            out.append(obj)
    return out


def _label_fields(item: dict[str, Any]) -> dict[str, str]:
    """Brand/Condition/Size from the accessibility label, after the title."""
    box = item.get("itemBox") or {}
    label = str(box.get("accessibilityLabel") or "")
    title = str(item.get("title") or "")
    rest = label[len(title) :] if label.startswith(title) else label
    return {k.lower(): v.strip() for k, v in LABEL_FIELD.findall(rest)}


def parse_item(item: dict[str, Any]) -> Listing | None:
    price = item.get("price") or {}
    amount = _dec(price.get("amount"))
    currency = price.get("currencyCode")
    if amount is None or not currency or not item.get("id") or not item.get("title"):
        return None
    total = item.get("totalItemPrice") or {}
    total_amount = _dec(total.get("amount")) if total.get("currencyCode") == currency else None
    fields = _label_fields(item)

    images = [p["url"] for p in item.get("photos") or [] if isinstance(p, dict) and p.get("url")]
    if not images and item.get("thumbnailUrl"):
        images = [item["thumbnailUrl"]]

    user = item.get("user") or {}
    path = str(item.get("url") or f"/items/{item['id']}")
    return Listing(
        source="vinted",
        source_id=str(item["id"]),
        url=path if path.startswith("http") else f"{BASE}{path}",
        title=str(item["title"]),
        brand=fields.get("brand"),
        price=amount,
        currency=currency,
        # What you actually pay before postage: Vinted's buyer-protection fee is compulsory.
        price_gbp=to_gbp(total_amount or amount, currency),
        size=fields.get("size"),
        condition=fields.get("condition"),
        images=images,
        seller=Seller(name=f"#{user['id']}") if user.get("id") else None,
        country="GB",
        raw=item,
    )


def parse_page(html: str) -> list[Listing]:
    flight = flight_text(html)
    if not flight:
        raise SourceError("Vinted page has no Next.js data (blocked or page format changed)")
    out: list[Listing] = []
    for item in product_items(flight):
        listing = parse_item(item)
        if listing is not None:
            out.append(listing)
    return out


def trim_page(html: str) -> str:
    """Re-emit only the result objects, in the same flight format, for small recorded fixtures."""
    items = product_items(flight_text(html))
    payload = ",".join(
        json.dumps({"productItem": i}, ensure_ascii=False, separators=(",", ":")) for i in items
    )
    chunk = json.dumps(payload, ensure_ascii=False)
    return f"<script>self.__next_f.push([1,{chunk}])</script>\n"


def build_search_params(query: SearchQuery) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = [("search_text", query.text)]
    if query.newest_first:
        params.append(("order", "newest_first"))
    for cid in CATALOG_IDS[query.category]:
        params.append(("catalog[]", str(cid)))
    if query.max_price_gbp is not None:
        params.append(("price_to", str(query.max_price_gbp)))
        params.append(("currency", "GBP"))
    return params


class VintedAdapter:
    name = "vinted"

    def __init__(
        self, *, min_interval: float = 10.0, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._http = RateLimitedClient(
            min_interval,
            transport=transport,
            headers={"Accept": "text/html", "Accept-Language": "en-GB"},
        )

    async def fetch_page(self, query: SearchQuery) -> str:
        resp = await self._http.get(CATALOG_URL, params=build_search_params(query))
        if resp.status_code in (403, 429):
            raise SourceError(f"Vinted refused the request (HTTP {resp.status_code}); not retrying")
        if resp.status_code != 200:
            raise SourceError(f"Vinted search failed: HTTP {resp.status_code}")
        return resp.text

    async def search(self, query: SearchQuery) -> list[Listing]:
        return parse_page(await self.fetch_page(query))[: query.limit]

    async def get_listing(self, url_or_id: str) -> Listing | None:
        # Item pages aren't parsed yet (needed for price-drop checks in Phase 4).
        return None

    async def aclose(self) -> None:
        await self._http.aclose()
