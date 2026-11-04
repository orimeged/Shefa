"""What a point-of-sale export says about a product beyond its name.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.add_column(sa.Column('brand', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('size', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('subcategory', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('source', sa.String(length=16), nullable=True))



def downgrade() -> None:
    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.drop_column('source')
        batch_op.drop_column('subcategory')
        batch_op.drop_column('size')
        batch_op.drop_column('brand')

