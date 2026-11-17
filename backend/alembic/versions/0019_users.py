"""Accounts: users and invites (v2.1 step 1)

The owner account is not inserted here: the API creates it from RACK_PASSWORD_HASH (and
RACK_OWNER_USERNAME) the first time anyone logs in while the table is empty
(`rack.accounts.ensure_owner`), keeping the current session epoch so nothing else changes.
Personal tables get their owner column in step 2 (0020).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(60), nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("disabled_at", TS),
        sa.Column("session_epoch", sa.Integer, nullable=False, server_default="0"),
        sa.Column("avatar_version", sa.Integer),
        sa.Column("last_active_at", TS),
        sa.CheckConstraint("role IN ('owner', 'friend')", name="ck_users_role"),
        sa.CheckConstraint("username = lower(username)", name="ck_users_lowercase"),
    )
    # at most one owner
    op.create_index(
        "uq_users_one_owner", "users", ["role"], unique=True, postgresql_where="role = 'owner'"
    )
    op.create_table(
        "invites",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("note", sa.String(100)),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("used_at", TS),
        sa.Column("used_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revoked_at", TS),
    )


def downgrade() -> None:
    op.drop_table("invites")
    op.drop_index("uq_users_one_owner", table_name="users")
    op.drop_table("users")
