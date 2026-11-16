"""optional LLM re-rank verdicts on listing scores

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("listing_scores", sa.Column("llm_score", sa.Float()))
    op.add_column("listing_scores", sa.Column("llm_why", sa.Text()))
    op.add_column("listing_scores", sa.Column("llm_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    for c in ("llm_at", "llm_why", "llm_score"):
        op.drop_column("listing_scores", c)
