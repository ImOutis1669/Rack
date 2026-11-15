"""SQLAlchemy ORM models. Each phase adds tables via a new Alembic migration."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

EMBED_DIM = 512


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON().with_variant(JSONB(), "postgresql")}


class ListingRow(Base):
    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_listing_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    source_id: Mapped[str] = mapped_column(String(128))
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String(200), index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    price_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), index=True)
    shipping_cost_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    size: Mapped[str | None] = mapped_column(String(64))
    condition: Mapped[str | None] = mapped_column(String(64))
    seller_name: Mapped[str | None] = mapped_column(String(200))
    seller_rating: Mapped[float | None]
    seller_count: Mapped[int | None]
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    location: Mapped[str | None] = mapped_column(String(200))
    country: Mapped[str | None] = mapped_column(String(2))
    raw: Mapped[dict[str, Any]] = mapped_column(default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    images: Mapped[list["ListingImageRow"]] = relationship(
        back_populates="listing",
        order_by="ListingImageRow.position",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ListingImageRow(Base):
    __tablename__ = "listing_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    url: Mapped[str] = mapped_column(Text)
    url_hash: Mapped[str] = mapped_column(String(64), index=True)
    phash: Mapped[str | None] = mapped_column(String(32))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))

    listing: Mapped[ListingRow] = relationship(back_populates="images")


class SourceHealthRow(Base):
    __tablename__ = "source_health"

    source: Mapped[str] = mapped_column(String(32), primary_key=True)
    configured: Mapped[bool] = mapped_column(Boolean, default=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_errors: Mapped[int] = mapped_column(Integer, default=0)
    last_result_count: Mapped[int | None] = mapped_column(Integer)
