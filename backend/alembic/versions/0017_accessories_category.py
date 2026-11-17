"""Accessories as a category: re-categorise what's stored

No schema change (categories are short strings). The new category takes effect by:
- bumping the profile version, so the worker rescores every listing and stores its category
  again with the new title inference (belts, hats, bags... move out of "any");
- re-inferring sold comparables that were "any" (Grailed's own "accessories" mapped to any);
- marking wardrobe items without a chosen category for a fresh resale estimate, since their
  inferred category (and so their comparables) may have changed.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from rack.parsing.categories import infer_category
from rack.sources.base import Category

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE profile SET version = version + 1, updated_at = now()"))

    rows = conn.execute(sa.text("SELECT id, title FROM sold_listings WHERE category = 'any'"))
    ids = [r.id for r in rows if infer_category(r.title) == Category.ACCESSORIES]
    if ids:
        conn.execute(
            sa.text("UPDATE sold_listings SET category = 'accessories' WHERE id = ANY(:ids)"),
            {"ids": ids},
        )

    conn.execute(
        sa.text(
            "UPDATE taste_items SET estimate_at = NULL "
            "WHERE kind = 'wardrobe' AND category IS NULL"
        )
    )


def downgrade() -> None:
    op.execute("UPDATE sold_listings SET category = 'any' WHERE category = 'accessories'")
    op.execute("UPDATE listing_scores SET category = 'any' WHERE category = 'accessories'")
    op.execute("UPDATE hunts SET category = 'any' WHERE category = 'accessories'")
    op.execute("UPDATE taste_items SET category = NULL WHERE category = 'accessories'")
