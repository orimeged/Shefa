"""Search and routing for one store."""

import re
from collections.abc import Sequence
from itertools import pairwise

from app.domain.classifier import ClassifiedItem, ItemClassifier
from app.domain.dictionary import FoodDictionary
from app.domain.graph import StoreGraph
from app.domain.models import (
    Category,
    NodeType,
    ResolvedItem,
    Route,
    RouteLeg,
    RoutePoint,
    RouteStop,
    SearchHit,
    Section,
    Store,
    StoreMap,
)
from app.domain.routing import order_stops
from app.domain.search import CategorySearch, SearchMatch

# Below the dictionary's exact matches, so a search result never claims more than it knows.
_CLASSIFIER_SCORE = 0.7
# Speech-to-text punctuates a spoken list, sometimes with "and" in Hebrew or English.
_LIST_SEPARATORS = re.compile(r"[,،;.\n]+|\s+and\s+", re.IGNORECASE)


class UnknownReferenceError(ValueError):
    """A request named a node this store does not have."""


class NavigationService:
    def __init__(
        self,
        store: Store,
        dictionary: FoodDictionary | None = None,
        classifier: ItemClassifier | None = None,
    ) -> None:
        self._store = store
        self._map = StoreMap(**{field: getattr(store, field) for field in StoreMap.model_fields})
        self._graph = StoreGraph.from_store(store)
        known_ids = {category.id for category in store.categories}
        self._dictionary = (dictionary or FoodDictionary({})).limited_to(known_ids)
        self._search = CategorySearch(store, self._dictionary)
        self._classifier = classifier
        self._nodes = {node.id: node for node in store.nodes}
        self._sections = {section.id: section for section in store.sections}
        self._categories = {
            category.id: category for category in (*store.categories, *store.product_stops)
        }
        self._entrance = self._node_of_type(NodeType.ENTRANCE)
        self._checkout = self._node_of_type(NodeType.CHECKOUT)

    @property
    def store_map(self) -> StoreMap:
        return self._map

    @property
    def subcategories(self) -> dict[str, tuple[str, ...]]:
        """Each department's subcategories, from every product, placed or shelved."""
        found: dict[str, dict[str, None]] = {}
        for product in self._store.product_stops:
            if product.department_id and product.subcategory:
                found.setdefault(product.department_id, {})[product.subcategory] = None
        for product in self._store.products:
            if product.subcategory:
                found.setdefault(product.category_id, {})[product.subcategory] = None
        return {department: tuple(names) for department, names in found.items()}

    def is_on_map(self, x: float, y: float) -> bool:
        return 0 <= x <= self._map.width_m and 0 <= y <= self._map.height_m

    def search(self, query: str, limit: int) -> list[SearchHit]:
        return [self._hit(match) for match in self._search.search(query, limit)]

    def resolve_list(self, lines: Sequence[str]) -> list[ResolvedItem]:
        """Match a whole shopping list in one call, one or more items per line.

        The catalog and dictionary answer first, instantly and for free. Only
        lines they're unsure about go to the classifier, and if it has no answer
        their result stands.
        """
        parts_by_line = [self._search.resolve(line) for line in lines]
        unsure = [
            line
            for line, parts in zip(lines, parts_by_line, strict=True)
            if any(part.uncertain for part in parts)
        ]
        answers = self._classifier.classify(unsure, self._dictionary) if self._classifier and unsure else {}

        items: list[ResolvedItem] = []
        for index, (line, parts) in enumerate(zip(lines, parts_by_line, strict=True)):
            if line in answers:
                items += [self._classified(index, item) for item in answers[line]]
                continue
            items += [
                ResolvedItem(
                    line=index,
                    text=part.text,
                    hit=self._hit(part.match) if part.match else None,
                    source="catalog" if part.match else None,
                    dictionary_id=part.match.dictionary_id if part.match else None,
                )
                for part in parts
            ]
        return items

    def read_items(self, text: str) -> list[tuple[str, str | None]]:
        """Each item in a spoken list with its department id, from the dictionary alone."""
        parts = (
            part
            for piece in _LIST_SEPARATORS.split(text)
            for part in self._search.resolve(piece)
        )
        return [(part.text, self._department_of(part.match)) for part in parts]

    def _department_of(self, match: SearchMatch | None) -> str | None:
        if match is None:
            return None
        return self._categories[match.category_id].department_id or match.category_id

    def _classified(self, line: int, item: ClassifiedItem) -> ResolvedItem:
        if item.category_id is None or item.category_id not in self._categories:
            return ResolvedItem(line=line, text=item.text, hit=None, source=None)
        match = SearchMatch(item.category_id, item.text, _CLASSIFIER_SCORE)
        return ResolvedItem(
            line=line,
            text=item.text,
            hit=self._hit(match),
            source="llm",
            dictionary_id=item.dictionary_id,
        )

    def _hit(self, match: SearchMatch) -> SearchHit:
        category = self._categories[match.category_id]
        section = self._sections[category.section_id]
        return SearchHit(
            category_id=category.id,
            category_name=category.name,
            category_name_en=category.name_en,
            aisle_no=section.aisle_no,
            side=section.side,
            matched_text=match.matched_text,
            score=match.score,
        )

    def plan_route(self, category_ids: Sequence[str], start_node_id: str | None = None) -> Route:
        """Route through `category_ids`, ending at the checkout.

        `start_node_id` re-plans from the shopper's position; it defaults to
        the entrance.
        """
        start = start_node_id or self._entrance
        if start not in self._nodes:
            raise UnknownReferenceError(f"Unknown node: {start}")

        stops_by_node: dict[str, list[tuple[Category, Section]]] = {}
        unplaced: list[str] = []
        for category_id in dict.fromkeys(category_ids):
            category = self._categories.get(category_id)
            if category is None:
                unplaced.append(category_id)
                continue
            section = self._closest_section(category, start)
            stops_by_node.setdefault(section.node_id, []).append((category, section))

        visit_order = order_stops(self._graph, start, stops_by_node, self._checkout)
        legs = tuple(
            self._leg(from_node, to_node)
            for from_node, to_node in pairwise([start, *visit_order, self._checkout])
        )
        stops = tuple(
            self._stop(seq, category, section, leg_index)
            for seq, (leg_index, category, section) in enumerate(
                (leg_index, category, section)
                for leg_index, node_id in enumerate(visit_order)
                for category, section in stops_by_node[node_id]
            )
        )
        return Route(
            store_id=self._store.id,
            start_node_id=start,
            end_node_id=self._checkout,
            total_length_m=round(sum(leg.length_m for leg in legs), 2),
            stops=stops,
            legs=legs,
            unplaced_category_ids=tuple(unplaced),
        )

    def _closest_section(self, category: Category, start: str) -> Section:
        sections = (self._sections[id_] for id_ in (category.section_id, *category.other_section_ids))
        return min(sections, key=lambda section: self._graph.distance(start, section.node_id))

    def _leg(self, from_node: str, to_node: str) -> RouteLeg:
        points = tuple(
            RoutePoint(node_id=node_id, x=self._nodes[node_id].x, y=self._nodes[node_id].y)
            for node_id in self._graph.path(from_node, to_node)
        )
        return RouteLeg(
            to_node_id=to_node,
            length_m=round(self._graph.distance(from_node, to_node), 2),
            points=points,
        )

    def _stop(self, seq: int, category: Category, section: Section, leg_index: int) -> RouteStop:
        node = self._nodes[section.node_id]
        return RouteStop(
            seq=seq,
            category_id=category.id,
            category_name=category.name,
            category_name_en=category.name_en,
            node_id=node.id,
            aisle_no=section.aisle_no,
            side=section.side,
            x=node.x,
            y=node.y,
            leg_index=leg_index,
        )

    def _node_of_type(self, node_type: NodeType) -> str:
        return next(node.id for node in self._store.nodes if node.type is node_type)
