"""Store data and API result models.

Field names follow the database schema, so a SQL repository can replace the
JSON one without touching the domain.
"""

from collections import Counter
from collections.abc import Iterable
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class NodeType(StrEnum):
    ENTRANCE = "entrance"
    CHECKOUT = "checkout"
    JUNCTION = "junction"
    SECTION = "section"


class Side(StrEnum):
    LEFT = "left"
    RIGHT = "right"


class Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class StoreNode(Model):
    id: str
    x: float
    y: float
    type: NodeType


class StoreEdge(Model):
    from_node: str
    to_node: str
    length_m: float = Field(gt=0)


class Section(Model):
    id: str
    node_id: str
    aisle_no: int = Field(ge=1)
    side: Side


class Category(Model):
    """Something a shopper can be routed to.

    Usually a department. A product a manager placed itself is one too, with
    `department_id` naming the department it belongs to.
    """

    id: str
    name: str
    name_en: str
    section_id: str
    # Where else it stands. The route goes to whichever is closest.
    other_section_ids: tuple[str, ...] = ()
    aliases: tuple[str, ...] = ()
    department_id: str | None = None


class Product(Model):
    barcode: str
    name: str
    category_id: str


class StoreMap(Model):
    """Everything a client needs to draw the store."""

    id: str
    name: str
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    nodes: tuple[StoreNode, ...]
    edges: tuple[StoreEdge, ...]
    sections: tuple[Section, ...]
    categories: tuple[Category, ...]
    # Kept apart from the departments, which are what shoppers browse.
    product_stops: tuple[Category, ...] = ()


class Store(StoreMap):
    products: tuple[Product, ...] = ()

    @model_validator(mode="after")
    def _check_references(self) -> Self:
        node_ids = _unique_ids("node", (node.id for node in self.nodes))
        section_ids = _unique_ids("section", (section.id for section in self.sections))
        targets = (*self.categories, *self.product_stops)
        _unique_ids("route target", (target.id for target in targets))
        category_ids = {category.id for category in self.categories}
        _unique_ids("product", (product.barcode for product in self.products))

        types = Counter(node.type for node in self.nodes)
        if types[NodeType.ENTRANCE] != 1 or types[NodeType.CHECKOUT] != 1:
            raise ValueError("a store needs exactly one entrance and one checkout")

        section_nodes = {node.id for node in self.nodes if node.type is NodeType.SECTION}
        _require_known("edge node", (e.from_node for e in self.edges), node_ids)
        _require_known("edge node", (e.to_node for e in self.edges), node_ids)
        _require_known("section node", (s.node_id for s in self.sections), section_nodes)
        _require_known(
            "category section",
            (id_ for t in targets for id_ in (t.section_id, *t.other_section_ids)),
            section_ids,
        )
        _require_known("product category", (p.category_id for p in self.products), category_ids)
        return self


def _unique_ids(kind: str, ids: Iterable[str]) -> set[str]:
    counts = Counter(ids)
    duplicates = sorted(value for value, count in counts.items() if count > 1)
    if duplicates:
        raise ValueError(f"duplicate {kind} ids: {duplicates}")
    return set(counts)


def _require_known(kind: str, values: Iterable[str], known: set[str]) -> None:
    missing = sorted(set(values) - known)
    if missing:
        raise ValueError(f"unknown {kind}: {missing}")


class SearchHit(Model):
    category_id: str
    category_name: str
    category_name_en: str
    aisle_no: int
    side: Side
    matched_text: str
    score: float


class ResolvedItem(Model):
    """One item from a shopping-list line. `hit` is None when the store has no match."""

    line: int
    text: str
    hit: SearchHit | None
    source: Literal["catalog", "llm"] | None
    dictionary_id: str | None = None


class Department(Model):
    """What a category holds in everyday terms, for the dictionary and the classifier."""

    description: str
    terms: tuple[str, ...]


class RoutePoint(Model):
    node_id: str
    x: float
    y: float


class RouteLeg(Model):
    to_node_id: str
    length_m: float
    points: tuple[RoutePoint, ...]


class RouteStop(Model):
    seq: int
    category_id: str
    category_name: str
    category_name_en: str
    node_id: str
    aisle_no: int
    side: Side
    x: float
    y: float
    leg_index: int


class Route(Model):
    """A walk through the store.

    `legs[stop.leg_index]` ends at that stop, and the last leg ends at the
    checkout. Stops on the same node share a leg. `unplaced_category_ids` lists what
    was asked for and no longer stands anywhere: a manager can change the store
    during someone's trip, and that mustn't cost them the rest of their route.
    """

    store_id: str
    start_node_id: str
    end_node_id: str
    total_length_m: float
    stops: tuple[RouteStop, ...]
    legs: tuple[RouteLeg, ...]
    unplaced_category_ids: tuple[str, ...] = ()
