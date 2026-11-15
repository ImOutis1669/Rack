"""taste profile, scores, feedback

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)
NOW = sa.text("now()")


def _vec() -> pgvector.sqlalchemy.Vector:
    return pgvector.sqlalchemy.Vector(512)


def upgrade() -> None:
    op.add_column("listings", sa.Column("text_embedding", _vec()))
    op.add_column(
        "listing_images",
        sa.Column("embed_attempts", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "profile",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", TS, nullable=False, server_default=NOW),
    )
    op.create_table(
        "designers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("weight", sa.String(16), nullable=False),
    )
    op.create_table(
        "adjacent_designers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("designer", sa.String(200), nullable=False, index=True),
        sa.Column("adjacent", sa.String(200), nullable=False),
        sa.UniqueConstraint("designer", "adjacent", name="uq_adjacent_pair"),
    )
    op.create_table(
        "taste_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False, index=True),
        sa.Column("image_path", sa.Text()),
        sa.Column("image_url", sa.Text()),
        sa.Column("text", sa.Text()),
        sa.Column("note", sa.Text()),
        sa.Column("embedding", _vec()),
        sa.Column("text_embedding", _vec()),
        sa.Column("embed_error", sa.Text()),
        sa.Column("embed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", TS, nullable=False, server_default=NOW),
    )
    op.create_table(
        "listing_scores",
        sa.Column(
            "listing_id",
            sa.Integer(),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("score", sa.Float(), nullable=False, index=True),
        sa.Column("components", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("why", sa.Text()),
        sa.Column("category", sa.String(16), nullable=False, server_default="any", index=True),
        sa.Column("measurements", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("filtered_reason", sa.String(64)),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column("computed_at", TS, nullable=False, server_default=NOW),
    )
    for name, extra in (
        ("feedback", [sa.Column("value", sa.Integer(), nullable=False)]),
        ("saved", [sa.Column("price_gbp_at_save", sa.Numeric(12, 2))]),
        ("seen", []),
    ):
        ts_col = {"feedback": "created_at", "saved": "saved_at", "seen": "seen_at"}[name]
        op.create_table(
            name,
            sa.Column(
                "listing_id",
                sa.Integer(),
                sa.ForeignKey("listings.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            *extra,
            sa.Column(ts_col, TS, nullable=False, server_default=NOW),
        )
    op.create_table(
        "hidden",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("value", sa.String(200), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=NOW),
        sa.UniqueConstraint("kind", "value", name="uq_hidden"),
    )
    op.create_table(
        "app_state",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    for t in (
        "app_state",
        "hidden",
        "seen",
        "saved",
        "feedback",
        "listing_scores",
        "taste_items",
        "adjacent_designers",
        "designers",
        "profile",
    ):
        op.drop_table(t)
    op.drop_column("listing_images", "embed_attempts")
    op.drop_column("listings", "text_embedding")
