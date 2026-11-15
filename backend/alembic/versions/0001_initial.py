"""initial: listings, listing_images, source_health

Revision ID: 0001
Revises:
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "listings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("brand", sa.String(200)),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("price_gbp", sa.Numeric(12, 2)),
        sa.Column("shipping_cost_gbp", sa.Numeric(12, 2)),
        sa.Column("size", sa.String(64)),
        sa.Column("condition", sa.String(64)),
        sa.Column("seller_name", sa.String(200)),
        sa.Column("seller_rating", sa.Float()),
        sa.Column("seller_count", sa.Integer()),
        sa.Column("listed_at", sa.DateTime(timezone=True)),
        sa.Column("location", sa.String(200)),
        sa.Column("country", sa.String(2)),
        sa.Column("raw", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "source_id", name="uq_listing_source"),
    )
    op.create_index("ix_listings_source", "listings", ["source"])
    op.create_index("ix_listings_brand", "listings", ["brand"])
    op.create_index("ix_listings_price_gbp", "listings", ["price_gbp"])
    op.create_index("ix_listings_last_seen_at", "listings", ["last_seen_at"])
    op.create_index("ix_listings_first_seen_id", "listings", ["first_seen_at", "id"])

    op.create_table(
        "listing_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "listing_id",
            sa.Integer(),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(64), nullable=False),
        sa.Column("phash", sa.String(32)),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(512)),
    )
    op.create_index("ix_listing_images_listing_id", "listing_images", ["listing_id"])
    op.create_index("ix_listing_images_url_hash", "listing_images", ["url_hash"])
    op.execute(
        "CREATE INDEX ix_listing_images_embedding ON listing_images "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "source_health",
        sa.Column("source", sa.String(32), primary_key=True),
        sa.Column("configured", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text()),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consecutive_errors", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_result_count", sa.Integer()),
    )


def downgrade() -> None:
    op.drop_table("source_health")
    op.drop_table("listing_images")
    op.drop_table("listings")
