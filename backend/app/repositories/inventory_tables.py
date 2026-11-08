"""The inventory schema: what stands where in a store.

The routing graph stays in the store's JSON file and belongs to us. These tables hold
what managers change. `MapNode` is the bridge between the two: it names a zone on
the drawn map and points at the section that routing walks to. A tile floor plan a
manager draws in the dashboard's editor sits on the store's own row.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_ID_LENGTH = 64
_NAME_LENGTH = 200
# JSONB on PostgreSQL, kept parsed and compact; plain JSON text on SQLite.
_DOCUMENT = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class StoreRecord(Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(_ID_LENGTH), primary_key=True)
    # Goes up with every inventory change, so a server process can tell its copy is old.
    version: Mapped[int] = mapped_column(default=0)
    # The editor's payload as saved, and when: the time tells a process its router is old.
    floor_plan: Mapped[dict[str, Any] | None] = mapped_column(_DOCUMENT, default=None)
    floor_plan_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


class MapNode(Base):
    __tablename__ = "map_nodes"
    __table_args__ = (
        UniqueConstraint("store_id", "svg_element_id"),
        UniqueConstraint("store_id", "section_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"))
    section_id: Mapped[str] = mapped_column(String(_ID_LENGTH))
    zone_name: Mapped[str] = mapped_column(String(_NAME_LENGTH))
    svg_element_id: Mapped[str] = mapped_column(String(_ID_LENGTH))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("store_id", "slug"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"))
    # The id shoppers' clients and the classifier know a category by.
    slug: Mapped[str] = mapped_column(String(_ID_LENGTH))
    name: Mapped[str] = mapped_column(String(_NAME_LENGTH))
    name_en: Mapped[str] = mapped_column(String(_NAME_LENGTH))
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("store_id", "name_key"),
        UniqueConstraint("store_id", "barcode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"))
    name: Mapped[str] = mapped_column(String(_NAME_LENGTH))
    # The normalized name, so saying a product twice can't create it twice.
    name_key: Mapped[str] = mapped_column(String(_NAME_LENGTH))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    # A manager can name a product without knowing its barcode.
    barcode: Mapped[str | None] = mapped_column(String(_ID_LENGTH), default=None)
    brand: Mapped[str | None] = mapped_column(String(_NAME_LENGTH), default=None)
    size: Mapped[str | None] = mapped_column(String(_NAME_LENGTH), default=None)
    subcategory: Mapped[str | None] = mapped_column(String(_NAME_LENGTH), default=None)
    # "pos" for a row from a catalog import, which the next import may update or drop.
    source: Mapped[str | None] = mapped_column(String(16), default=None)


class NodeAssignment(Base):
    """A product or a whole category standing at a node.

    `entity_id` points at one of two tables, so it can't be a foreign key. Whatever
    deletes a product or a category must clear its rows here.
    """

    __tablename__ = "node_assignments"
    __table_args__ = (
        CheckConstraint("entity_type IN ('product', 'category')", name="known_entity_type"),
        Index("ix_node_assignments_entity", "entity_type", "entity_id"),
    )

    node_id: Mapped[int] = mapped_column(ForeignKey("map_nodes.id"), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    entity_id: Mapped[int] = mapped_column(primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

# Declared here too, so Base.metadata is the whole database: inventory, reports and analytics.
from app.repositories import event_tables  # noqa: E402, F401
