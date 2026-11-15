"""Currency conversion to GBP.

Phase 1 uses static fallback rates.
Phase 5 adds daily ECB rates (frankfurter.app) stored in fx_rates.
"""

from decimal import ROUND_HALF_UP, Decimal

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


def to_gbp(
    amount: Decimal, currency: str, rates: dict[str, Decimal] | None = None
) -> Decimal | None:
    table = rates or FALLBACK_TO_GBP
    rate = table.get(currency.upper())
    if rate is None:
        return None
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
