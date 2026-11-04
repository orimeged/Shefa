"""The inventory schema: zones, categories, products and what stands where.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('stores',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('categories',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('store_id', sa.String(length=64), nullable=False),
    sa.Column('slug', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('name_en', sa.String(length=200), nullable=False),
    sa.Column('aliases', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('store_id', 'slug')
    )
    op.create_table('map_nodes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('store_id', sa.String(length=64), nullable=False),
    sa.Column('section_id', sa.String(length=64), nullable=False),
    sa.Column('zone_name', sa.String(length=200), nullable=False),
    sa.Column('svg_element_id', sa.String(length=64), nullable=False),
    sa.Column('x', sa.Float(), nullable=False),
    sa.Column('y', sa.Float(), nullable=False),
    sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('store_id', 'section_id'),
    sa.UniqueConstraint('store_id', 'svg_element_id')
    )
    op.create_table('node_assignments',
    sa.Column('node_id', sa.Integer(), nullable=False),
    sa.Column('entity_type', sa.String(length=16), nullable=False),
    sa.Column('entity_id', sa.Integer(), nullable=False),
    sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("entity_type IN ('product', 'category')", name='known_entity_type'),
    sa.ForeignKeyConstraint(['node_id'], ['map_nodes.id'], ),
    sa.PrimaryKeyConstraint('node_id', 'entity_type', 'entity_id')
    )
    with op.batch_alter_table('node_assignments', schema=None) as batch_op:
        batch_op.create_index('ix_node_assignments_entity', ['entity_type', 'entity_id'], unique=False)

    op.create_table('products',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('store_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('name_key', sa.String(length=200), nullable=False),
    sa.Column('category_id', sa.Integer(), nullable=False),
    sa.Column('barcode', sa.String(length=64), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('store_id', 'barcode'),
    sa.UniqueConstraint('store_id', 'name_key')
    )


def downgrade() -> None:
    op.drop_table('products')
    with op.batch_alter_table('node_assignments', schema=None) as batch_op:
        batch_op.drop_index('ix_node_assignments_entity')

    op.drop_table('node_assignments')
    op.drop_table('map_nodes')
    op.drop_table('categories')
    op.drop_table('stores')
