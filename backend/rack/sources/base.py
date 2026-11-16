"""Source adapter interface and the normalised Listing model shared by all marketplaces."""

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any, Protocol
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, ValidationError, field_validator


class Category(StrEnum):
    ANY = "any"
    TOPS = "tops"
    TROUSERS = "trousers"
    SHOES = "shoes"
    OUTERWEAR = "outerwear"


class SearchQuery(BaseModel):
    text: str
    category: Category = Category.ANY
    max_price_gbp: Decimal | None = None
    size: str | None = None
    limit: int = 50
    newest_first: bool = True


class Seller(BaseModel):
    name: str | None = None
    rating: float | None = None  # normalised 0..100 (percentage positive / stars*20)
    count: int | None = None


class Listing(BaseModel):
    source: str
    source_id: str
    url: str
    title: str
    description: str | None = None
    brand: str | None = None
    price: Decimal
    currency: str
    price_gbp: Decimal | None = None
    size: str | None = None
    condition: str | None = None
    images: list[str] = Field(default_factory=list)
    seller: Seller | None = None
    listed_at: datetime | None = None
    location: str | None = None
    country: str | None = None  # ISO 3166-1 alpha-2
    shipping_cost: Decimal | None = None  # in `currency`
    raw: dict[str, Any] = Field(default_factory=dict)

    @field_validator("url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        # third-party data ends up in <a href>: never allow javascript:, data:, etc.
        parts = urlsplit(v)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("listing URL must be an absolute http(s) URL")
        return v

    @field_validator("images")
    @classmethod
    def _http_images(cls, v: list[str]) -> list[str]:
        return [u for u in v if urlsplit(u).scheme in ("http", "https")]


def build_listing(**fields: Any) -> "Listing | None":
    """Listing, or None if the source data is invalid (e.g. a non-http URL)."""
    try:
        return Listing(**fields)
    except ValidationError:
        return None


class SourceError(Exception):
    """Raised by adapters for any failure; the caller records it in source_health."""


class SourceNotConfigured(SourceError):
    """Adapter lacks credentials/config and should be skipped, not counted as an error."""


class SourceAdapter(Protocol):
    name: str

    async def search(self, query: SearchQuery) -> list[Listing]: ...

    async def get_listing(self, url_or_id: str) -> Listing | None: ...
