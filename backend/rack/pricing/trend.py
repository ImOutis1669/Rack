"""Is a wardrobe item's resale value rising or falling? From real sale prices (Grailed sold, 5c).

The median sold price of the item's comparable sales in the latest 30 (or 90) days is compared with
the period before. Only shown with enough sales on both sides; small moves read as steady. Grailed
sales are mostly US, so treat this as a rough market signal, not a price index.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta
from decimal import Decimal
from statistics import median
from typing import Any

MIN_SALES = 5  # per period, on each side of the comparison
STEADY_PCT = 5.0  # |change| below this reads as "steady"
WINDOWS = (30, 90)
BUCKET_DAYS = 30
BUCKETS = 6  # sparkline: monthly medians over the last 180 days
MIN_BUCKET_SALES = 2

Sale = tuple[datetime, Decimal]


def _median(prices: Sequence[Decimal]) -> Decimal:
    return Decimal(str(median(prices))).quantize(Decimal("0.01"))


def window_change(sales: Sequence[Sale], now: datetime, days: int) -> dict[str, Any] | None:
    """Latest `days` vs the `days` before. None when either side has too few sales."""
    span = timedelta(days=days)
    recent = [p for t, p in sales if now - span < t <= now]
    prior = [p for t, p in sales if now - 2 * span < t <= now - span]
    if len(recent) < MIN_SALES or len(prior) < MIN_SALES:
        return None
    before, after = _median(prior), _median(recent)
    pct = float((after - before) / before * 100) if before > 0 else 0.0
    direction = "steady" if abs(pct) < STEADY_PCT else ("up" if pct > 0 else "down")
    return {
        "pct": round(pct, 1),
        "direction": direction,
        "recent_median": str(after),
        "prior_median": str(before),
        "recent_sales": len(recent),
        "prior_sales": len(prior),
    }


def monthly_points(sales: Sequence[Sale], now: datetime) -> list[dict[str, Any]]:
    """Oldest first; a bucket with too few sales has median None (a gap in the sparkline)."""
    out: list[dict[str, Any]] = []
    for i in reversed(range(BUCKETS)):
        end = now - timedelta(days=BUCKET_DAYS * i)
        start = end - timedelta(days=BUCKET_DAYS)
        prices = [p for t, p in sales if start < t <= end]
        out.append(
            {
                "end": end.date().isoformat(),
                "median": str(_median(prices)) if len(prices) >= MIN_BUCKET_SALES else None,
                "sales": len(prices),
            }
        )
    return out


def compute_trend(sales: Sequence[Sale], now: datetime) -> dict[str, Any]:
    return {
        **{str(d): window_change(sales, now, d) for d in WINDOWS},
        "points": monthly_points(sales, now),
        "sales": len(sales),
    }
