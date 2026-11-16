"""Rough landed-cost estimate for buying into the UK. Always labelled as an estimate.

UK rules as of 2026 (simplified):
- Goods sent from abroad pay 20% UK VAT on item + shipping. At or under £135 the marketplace
  charges it at checkout; above £135 it's collected on import.
- Above £135, customs duty may apply (clothing/footwear typically ~12%, on item + shipping); it is
  often £0 for goods *made* in the EU, which a listing can't tell us. VAT is then charged on
  item + shipping + duty, and couriers add a handling fee.
- Domestic (UK) listings: price + postage, nothing else.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

LOW_VALUE_THRESHOLD = Decimal(135)
VAT = Decimal("0.20")
UK_NAMES = {"gb", "uk", "united kingdom", "great britain", "england", "scotland", "wales"}


@dataclass
class Landed:
    total_gbp: Decimal
    item_gbp: Decimal
    shipping_gbp: Decimal | None
    vat_gbp: Decimal = Decimal(0)
    duty_gbp: Decimal = Decimal(0)
    fee_gbp: Decimal = Decimal(0)
    imported: bool = False
    notes: list[str] = field(default_factory=list)


def _q(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def ships_from_uk(source: str, country: str | None, location: str | None) -> bool | None:
    """True/False when we can tell, None when we can't."""
    if source == "vinted":
        return True  # vinted.co.uk is a UK-only marketplace
    for v in (country, location):
        if v:
            return v.strip().lower() in UK_NAMES
    return None


def estimate(
    *,
    source: str,
    price_gbp: Decimal | None,
    shipping_gbp: Decimal | None,
    country: str | None,
    location: str | None,
    duty_rate: Decimal = Decimal("0.12"),
    handling_fee_gbp: Decimal = Decimal(12),
) -> Landed | None:
    if price_gbp is None:
        return None
    uk = ships_from_uk(source, country, location)
    if uk is None:
        return None
    ship = shipping_gbp or Decimal(0)
    notes: list[str] = []
    if shipping_gbp is None:
        notes.append("postage not included")
    if uk:
        return Landed(_q(price_gbp + ship), price_gbp, shipping_gbp, notes=notes)

    base = price_gbp + ship
    if price_gbp <= LOW_VALUE_THRESHOLD:
        vat = _q(base * VAT)
        notes.append("UK VAT charged at checkout")
        return Landed(
            _q(base + vat), price_gbp, shipping_gbp, vat_gbp=vat, imported=True, notes=notes
        )
    duty = _q(base * duty_rate)
    vat = _q((base + duty) * VAT)
    notes.append("import VAT, duty (often £0 for EU-made goods) and courier fee on delivery")
    return Landed(
        _q(base + duty + vat + handling_fee_gbp),
        price_gbp,
        shipping_gbp,
        vat_gbp=vat,
        duty_gbp=duty,
        fee_gbp=handling_fee_gbp,
        imported=True,
        notes=notes,
    )
