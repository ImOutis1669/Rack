"""wardrobe items: a value you type in ("worth now")

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("taste_items", sa.Column("custom_value_gbp", sa.Numeric(12, 2)))


def downgrade() -> None:
    op.drop_column("taste_items", "custom_value_gbp")
