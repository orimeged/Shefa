"""Where on its shelf a product stands: which quarter along the shelf's length.

A gondola can run eighteen metres, and sending a shopper to its middle for water
that stands at one end is the walk they notice. `shelf_part` is 0 to 3 along the
shelf, from its top or left end as the floor plan is drawn; empty when nobody said,
and the route goes to the shelf's middle as before.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(sa.Column("shelf_part", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_column("shelf_part")
