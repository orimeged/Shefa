"""What store managers work with: zones on the map and what stands in them."""

from enum import StrEnum

from pydantic import ConfigDict, Field

from app.domain.models import Model

MAX_ITEM_NAME = 120


class EntityType(StrEnum):
    PRODUCT = "product"
    CATEGORY = "category"


class InventoryError(Exception):
    """A request named something this store doesn't have."""


class InvalidItemError(InventoryError):
    """An item can't be saved as it was written."""


class LayoutConflictError(Exception):
    """A new floor plan would drop a zone that still holds inventory."""


class CatalogRow(Model):
    """One line of a point-of-sale export."""

    barcode: str
    department: str
    subcategory: str
    brand: str
    item: str
    size: str
    zone: str

    @property
    def display_name(self) -> str:
        return f"{self.item} {self.brand} {self.size}"


class Zone(Model):
    id: int
    zone_name: str
    svg_element_id: str
    section_id: str
    x: float
    y: float
    item_count: int
    # The department standing here, to label the zone on the map.
    preview: str | None
    preview_en: str | None


class CatalogCategory(Model):
    id: int
    slug: str
    name: str
    name_en: str
    # Its products' subcategories, which a drawn plan can give shelves of their own.
    subcategories: tuple[str, ...] = ()


class ZoneItem(Model):
    entity_type: EntityType
    entity_id: int
    name: str
    category_name: str
    category_name_en: str
    # How many products a category covers. None for a product.
    product_count: int | None = None
    subcategory: str | None = None
    barcode: str | None = None


class CatalogEntry(Model):
    entity_type: EntityType
    entity_id: int
    name: str
    category_name: str


class StagedItem(Model):
    """An item a manager approved. New names become products."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=MAX_ITEM_NAME)
    category_id: int


class DictatedItem(Model):
    """One item as heard, for a manager to review. Field names are the public contract."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    normalized_name: str = Field(min_length=1, max_length=MAX_ITEM_NAME)
    # A category slug, or "none" when no category fits.
    inferred_category: str
