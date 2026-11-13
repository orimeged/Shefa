"""The floor staff's phones that asked for alerts.

A browser that allows notifications hands out a push subscription: an address at
its push service (Apple's, Google's, Mozilla's) and two keys to encrypt for it. One
row per phone and store. A row goes when the push service says the phone is gone.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_TIME = sa.Text().with_variant(sa.Text(collation="C"), "postgresql")


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("endpoint", sa.Text(), primary_key=True),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("created_at", _TIME, nullable=False),
    )
    op.create_index("idx_push_subscriptions_store", "push_subscriptions", ["store_id"])


def downgrade() -> None:
    op.drop_table("push_subscriptions")
