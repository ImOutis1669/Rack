"""wardrobe items: estimated resale value from comparable listings (5b)

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("taste_items", sa.Column("estimate_gbp", sa.Numeric(12, 2)))
    op.add_column("taste_items", sa.Column("estimate_count", sa.Integer()))
    op.add_column("taste_items", sa.Column("estimate_at", sa.DateTime(timezone=True)))
    op.add_column("taste_items", sa.Column("estimate_basis", postgresql.JSONB()))


def downgrade() -> None:
    for c in ("estimate_basis", "estimate_at", "estimate_count", "estimate_gbp"):
        op.drop_column("taste_items", c)
