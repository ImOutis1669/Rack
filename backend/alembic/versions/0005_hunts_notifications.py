"""hunts, hunt matches, sent notifications, price-drop tracking

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "hunts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("query", sa.String(300), nullable=False),
        sa.Column("category", sa.String(16), nullable=False, server_default="any"),
        sa.Column("max_price_gbp", sa.Numeric(12, 2)),
        sa.Column("sizes", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("sources", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("min_score", sa.Float()),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", TS),
        sa.Column("run_requested_at", TS),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "hunt_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "hunt_id", sa.Integer(), sa.ForeignKey("hunts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "listing_id",
            sa.Integer(),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("matched_at", TS, nullable=False, server_default=sa.text("now()")),
        sa.Column("baseline", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("hunt_id", "listing_id", name="uq_hunt_match"),
    )
    op.create_index("ix_hunt_matches_hunt", "hunt_matches", ["hunt_id", "matched_at"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(200), nullable=False, unique=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("listing_id", sa.Integer(), sa.ForeignKey("listings.id", ondelete="SET NULL")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("url", sa.Text()),
        sa.Column("channels", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("sent_at", TS, nullable=False, server_default=sa.text("now()")),
    )
    op.add_column("saved", sa.Column("last_alert_price_gbp", sa.Numeric(12, 2)))
    op.add_column("saved", sa.Column("price_checked_at", TS))


def downgrade() -> None:
    op.drop_column("saved", "price_checked_at")
    op.drop_column("saved", "last_alert_price_gbp")
    op.drop_table("notifications")
    op.drop_index("ix_hunt_matches_hunt", "hunt_matches")
    op.drop_table("hunt_matches")
    op.drop_table("hunts")
