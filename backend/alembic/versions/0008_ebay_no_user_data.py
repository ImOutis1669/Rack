"""remove eBay user data already stored (seller, item city/postcode, raw payload extras)

"I do not persist eBay data" (eBay Marketplace Account Deletion exemption): eBay rows keep only
item data. Data-only migration; new rows are cleaned by the adapter and rack.privacy.scrub.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Same allow-list as rack.sources.ebay.RAW_KEYS (copied: migrations must not import app code).
RAW_KEYS = (
    "itemId",
    "title",
    "shortDescription",
    "price",
    "image",
    "additionalImages",
    "size",
    "condition",
    "itemWebUrl",
    "brand",
    "itemCreationDate",
)


def clean_sql() -> str:
    pairs = ", ".join(f"'{k}', raw->'{k}'" for k in RAW_KEYS)
    return f"""
        UPDATE listings SET
            seller_name = NULL,
            seller_rating = NULL,
            seller_count = NULL,
            location = NULL,
            raw = jsonb_strip_nulls(jsonb_build_object(
                {pairs},
                'itemLocation', CASE WHEN raw->'itemLocation'->'country' IS NOT NULL
                    THEN jsonb_build_object('country', raw->'itemLocation'->'country') END
            ))
        WHERE source = 'ebay'
        """


def upgrade() -> None:
    op.execute(clean_sql())


def downgrade() -> None:
    pass  # deleted data can't (and mustn't) come back
