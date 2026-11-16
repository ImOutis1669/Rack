"""SQLAlchemy ORM models. Each phase adds tables via a new Alembic migration."""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
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
    # Why the listing is hidden for good (e.g. "womens"); searches don't reactivate it.
    excluded: Mapped[str | None] = mapped_column(String(32))
    text_embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    # Same item listed more than once (cross-listed / reposted): id of the cheapest copy.
    cluster_id: Mapped[int | None] = mapped_column(Integer, index=True)
    # Full photo set / description fetched from the item page (on demand, e.g. Vinted).
    details_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    # "I bought it": where the item came from (the listing itself is kept, never deleted)
    listing_id: Mapped[int | None] = mapped_column(
        ForeignKey("listings.id", ondelete="SET NULL"), index=True
    )
    source: Mapped[str | None] = mapped_column(String(32))
    listing_url: Mapped[str | None] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String(200))
    size: Mapped[str | None] = mapped_column(String(64))
    purchase_price_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # what you say it's worth now (wardrobe value; overrides any estimate)
    custom_value_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # estimated resale value: median asking price of comparable listings (pricing/resale.py).
    # estimate_at None = due (new photo or brand); estimate_count = comparables found.
    estimate_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    estimate_count: Mapped[int | None] = mapped_column(Integer)
    estimate_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimate_basis: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    estimate_kind: Mapped[str | None] = mapped_column(String(8))  # sold | asking
    sold_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # sold-price trend (pricing/trend.py): {"30": {...}, "90": {...}, "points": [...]}
    trend: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    # the Saved entry it replaced, so "Undo" can put it back exactly
    saved_snapshot: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)


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
    # optional LLM second opinion (0-10), kept for a few days; never overwritten by rescoring
    llm_score: Mapped[float | None]
    llm_why: Mapped[str | None] = mapped_column(Text)
    llm_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    last_alert_price_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    price_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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


# --- Phase 4: hunts and notifications ---


class HuntRow(Base):
    __tablename__ = "hunts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    query: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(16), default="any")
    max_price_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    sizes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    sources: Mapped[list[str]] = mapped_column(JSONB, default=list)  # empty = all free sources
    min_score: Mapped[float | None]
    interval_minutes: Mapped[int] = mapped_column(Integer, default=30)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    run_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HuntMatchRow(Base):
    __tablename__ = "hunt_matches"
    __table_args__ = (UniqueConstraint("hunt_id", "listing_id", name="uq_hunt_match"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    hunt_id: Mapped[int] = mapped_column(ForeignKey("hunts.id", ondelete="CASCADE"))
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"))
    matched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # found on the hunt's first run: shown, but not pushed (no alert storm for old listings)
    baseline: Mapped[bool] = mapped_column(Boolean, default=False)


class NotificationRow(Base):
    """One row per alert ever sent; the unique key is what stops duplicates."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(16))  # hunt | price_drop | test
    listing_id: Mapped[int | None] = mapped_column(ForeignKey("listings.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    channels: Mapped[dict[str, Any]] = mapped_column(default=dict)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --- Phase 5: price history, web push ---


class PriceObservationRow(Base):
    """A listing's price each time it changed (first row = price when first seen)."""

    __tablename__ = "price_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"))
    price_gbp: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PushSubscriptionRow(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    keys: Mapped[dict[str, Any]] = mapped_column(default=dict)  # p256dh, auth
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --- v1.1: sold prices (5c) ---


class SoldListingRow(Base):
    """A sold item from a marketplace's public sold index (Grailed). Item data only: no seller."""

    __tablename__ = "sold_listings"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_sold_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(16), default="any")
    size: Mapped[str | None] = mapped_column(String(64))
    sold_price_gbp: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    shipping_gbp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    image_url: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    embed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EstimateSnapshotRow(Base):
    """One estimate per wardrobe item per day, for asking-price trends later."""

    __tablename__ = "estimate_snapshots"
    __table_args__ = (UniqueConstraint("taste_item_id", "day", name="uq_snapshot_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    taste_item_id: Mapped[int] = mapped_column(ForeignKey("taste_items.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    estimate_gbp: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    count: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(8))
