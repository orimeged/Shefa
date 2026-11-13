"""What store managers work with: zones on the map and what stands in them."""

from datetime import datetime
from enum import StrEnum

from pydantic import ConfigDict, Field

from app.domain.models import Model

MAX_ITEM_NAME = 120
# ₪100,000: far above anything on a supermarket shelf, so a typo can't skew a report by millions.
MAX_PRICE_AGOROT = 10_000_000


# A route stop for one product, rather than a whole department, is "product-<id>".
_PRODUCT_STOP_PREFIX = "product-"


def product_stop_id(product_id: int) -> str:
    return f"{_PRODUCT_STOP_PREFIX}{product_id}"


def product_id_of_stop(stop_id: str) -> int | None:
    number = stop_id.removeprefix(_PRODUCT_STOP_PREFIX)
    return int(number) if number != stop_id and number.isdecimal() else None


class EntityType(StrEnum):
    PRODUCT = "product"
    CATEGORY = "category"


class InventoryError(Exception):
    """A request named something this store doesn't have."""


class DuplicateItemError(InventoryError):
    """Another product in the store already has this name or barcode."""


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
    # The shelf price in agorot, when the export carries one.
    price_agorot: int | None = None

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


class CatalogProduct(Model):
    """A product as the catalog screen lists it."""

    id: int
    name: str
    barcode: str | None
    brand: str | None
    size: str | None
    # The department's slug, which routes and reports know it by.
    department: str
    subcategory: str | None
    # "pos" for a row a catalog import brought, which the next import may change.
    source: str | None
    # How many of the graph's shelf zones it stands in.
    zones: int
    # The drawn plan's shelf a shopper is sent to for it; None with no plan, or none for it.
    shelf: str | None = None
    # The shelf price in agorot, and when it was last set; None when nobody has given one.
    price_agorot: int | None = None
    price_updated_at: datetime | None = None


class ProductDraft(Model):
    """A new product, as a manager types it."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_ITEM_NAME)
    barcode: str | None = Field(default=None, max_length=14)
    brand: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    size: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    department: str = Field(min_length=1, max_length=64)
    # The shelf it stands on, finer than its department: one of the plan's, as the screen offers them.
    subcategory: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    price_agorot: int | None = Field(default=None, ge=0, le=MAX_PRICE_AGOROT)


class ProductChanges(Model):
    """What a manager changed about a product; a field left out stays as it was, a null clears it."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_ITEM_NAME)
    barcode: str | None = Field(default=None, max_length=14)
    brand: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    size: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    department: str | None = Field(default=None, min_length=1, max_length=64)
    subcategory: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
    price_agorot: int | None = Field(default=None, ge=0, le=MAX_PRICE_AGOROT)


class PriceLine(Model):
    """One item of a chain's price file: its barcode and shelf price."""

    barcode: str
    price_agorot: int
    name: str | None = None


class PriceImport(Model):
    """What a price file changed: how many of its lines matched the catalog and moved a price."""

    lines: int
    matched: int
    updated: int
    # Products still with no price after it, which a report can only estimate.
    products_without_price: int


class PricedProduct(Model):
    id: int
    name: str
    name_key: str
    department: str
    price_agorot: int | None


class StaffProductDraft(Model):
    """A product a staff member scanned that the catalog didn't have: no price, which is the office's."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_ITEM_NAME)
    barcode: str | None = Field(default=None, max_length=14)
    department: str = Field(min_length=1, max_length=64)
    subcategory: str | None = Field(default=None, max_length=MAX_ITEM_NAME)


class StaffPlacement(Model):
    """Where a staff member found a product standing: its department and shelf, nothing else."""

    model_config = ConfigDict(extra="forbid")

    department: str | None = Field(default=None, min_length=1, max_length=64)
    subcategory: str | None = Field(default=None, max_length=MAX_ITEM_NAME)
