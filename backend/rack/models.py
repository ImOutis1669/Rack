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
    text_embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    # Same item listed more than once (cross-listed / reposted): id of the cheapest copy.
    cluster_id: Mapped[int | None] = mapped_column(Integer, index=True)
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
    embed_attempts: Mapped[int] = mapped_column(Integer, default=0)

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
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)  # site refuses Rack outright
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- Phase 2: taste profile, scoring, feedback ---


class ProfileRow(Base):
    """Single row (id=1). `data` is validated by rack.profile.Profile."""

    __tablename__ = "profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DesignerRow(Base):
    __tablename__ = "designers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    weight: Mapped[str] = mapped_column(String(16))  # love | like | curious | exclude


class AdjacentDesignerRow(Base):
    __tablename__ = "adjacent_designers"
    __table_args__ = (UniqueConstraint("designer", "adjacent", name="uq_adjacent_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    designer: Mapped[str] = mapped_column(String(200), index=True)
    adjacent: Mapped[str] = mapped_column(String(200))


class TasteItemRow(Base):
    __tablename__ = "taste_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # wardrobe | wishlist
    image_path: Mapped[str | None] = mapped_column(Text)  # uploaded file under /data/uploads
    image_url: Mapped[str | None] = mapped_column(Text)  # pasted URL (wishlist)
    text: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    text_embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    embed_error: Mapped[str | None] = mapped_column(Text)
    embed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ListingScoreRow(Base):
    __tablename__ = "listing_scores"

    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    score: Mapped[float] = mapped_column(index=True)
    components: Mapped[dict[str, Any]] = mapped_column(default=dict)
    why: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(16), default="any", index=True)
    measurements: Mapped[dict[str, Any]] = mapped_column(default=dict)
    filtered_reason: Mapped[str | None] = mapped_column(String(64))
    profile_version: Mapped[int] = mapped_column(Integer)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeedbackRow(Base):
    """Latest thumbs vote per listing (+1 / -1)."""

    __tablename__ = "feedback"

    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    value: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedRow(Base):
    __tablename__ = "saved"

    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    price_gbp_at_save: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HiddenRow(Base):
    __tablename__ = "hidden"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_hidden"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # seller | brand
    value: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SeenRow(Base):
    __tablename__ = "seen"

    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppStateRow(Base):
    """Small key/value store for worker state (query cursor, last scored version...)."""

    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(default=dict)
