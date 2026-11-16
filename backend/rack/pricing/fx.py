"""Currency conversion to GBP.

Daily ECB reference rates come from frankfurter.dev (free, no key); the worker fetches them once a
day and stores them in app_state['fx']. Until the first fetch, rough static fallbacks are used.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import httpx

from rack.sources.http import USER_AGENT

FX_URL = "https://api.frankfurter.dev/v1/latest"

# Units of GBP per 1 unit of currency. Rough fallbacks only.
FALLBACK_TO_GBP: dict[str, Decimal] = {
    "GBP": Decimal("1"),
    "EUR": Decimal("0.85"),
    "USD": Decimal("0.77"),
    "JPY": Decimal("0.0051"),
    "CHF": Decimal("0.90"),
    "SEK": Decimal("0.073"),
    "DKK": Decimal("0.114"),
    "PLN": Decimal("0.20"),
}

_live: dict[str, Decimal] | None = None


def set_live_rates(rates: dict[str, Decimal] | None) -> None:
    global _live
    _live = dict(rates) if rates else None


def current_rates() -> dict[str, Decimal]:
    return {**FALLBACK_TO_GBP, **(_live or {})}


def to_gbp(
    amount: Decimal, currency: str, rates: dict[str, Decimal] | None = None
) -> Decimal | None:
    table = rates or current_rates()
    rate = table.get(currency.upper())
    if rate is None:
        return None
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def parse_rates(payload: dict[str, Any]) -> dict[str, Decimal]:
    """frankfurter gives units-per-GBP; invert to GBP-per-unit."""
    out = {"GBP": Decimal("1")}
    for cur, per_gbp in (payload.get("rates") or {}).items():
        v = Decimal(str(per_gbp))
        if v > 0:
            out[str(cur).upper()] = (Decimal(1) / v).quantize(Decimal("0.000001"))
    return out


async def fetch_rates(
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[str, dict[str, Decimal]]:
    async with httpx.AsyncClient(
        timeout=15, headers={"User-Agent": USER_AGENT}, transport=transport
    ) as client:
        resp = await client.get(FX_URL, params={"base": "GBP"})
        resp.raise_for_status()
        data = resp.json()
    return str(data.get("date", "")), parse_rates(data)
