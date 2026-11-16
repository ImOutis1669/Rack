"""API response schemas."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class SellerOut(BaseModel):
    name: str | None
    rating: float | None
    count: int | None


class BuyLink(BaseModel):
    source: str
    url: str
    price_gbp: Decimal | None
    size: str | None = None


class LandedOut(BaseModel):
    """Estimated total cost delivered to the UK."""

    total_gbp: Decimal
    shipping_gbp: Decimal | None
    vat_gbp: Decimal
    duty_gbp: Decimal
    fee_gbp: Decimal
    imported: bool
    notes: list[str]


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    source_id: str
    url: str
    title: str
    brand: str | None
    price: Decimal
    currency: str
    price_gbp: Decimal | None
    shipping_cost_gbp: Decimal | None
    size: str | None
    condition: str | None
    images: list[str]
    seller: SellerOut | None
    listed_at: datetime | None
    first_seen_at: datetime
    country: str | None
    score: float | None = None
    why: str | None = None
    category: str | None = None
    measurements: dict[str, float] = {}
    feedback: int | None = None
    saved: bool = False
    price_gbp_at_save: Decimal | None = None
    was_price_gbp: Decimal | None = None  # original price, when the seller has since cut it
    landed: LandedOut | None = None
    buy_links: list[BuyLink]


class FeedPage(BaseModel):
    items: list[ListingOut]
    next_cursor: str | None


class SourceHealthOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: str
    configured: bool
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error: str | None
    error_count: int
    consecutive_errors: int
    last_result_count: int | None
    blocked: bool = False
    last_check_at: datetime | None = None
    status: str  # ok | degraded | down | blocked | not_configured | never_run
    usage: str | None = None  # e.g. "412 of 5,000 eBay searches today"
    usage_warning: bool = False  # above 80% of the daily quota


class VisitOut(BaseModel):
    visit_start: datetime
    last_visit: datetime | None
