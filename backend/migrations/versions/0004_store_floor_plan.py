"""The tile floor plan a manager draws in the dashboard, on the store's row.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("stores", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "floor_plan",
                sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column("floor_plan_updated_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("stores", schema=None) as batch_op:
        batch_op.drop_column("floor_plan_updated_at")
        batch_op.drop_column("floor_plan")
