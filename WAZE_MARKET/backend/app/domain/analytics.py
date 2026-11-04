"""What the dashboard learns from shoppers' lists and routes.

Both are counted once per shopping trip. The app re-plans a route every time a list
changes and searches as people type, so counting requests would measure tapping.
"""

from collections.abc import Sequence
from datetime import datetime
from itertools import pairwise
from typing import Protocol

from pydantic import BaseModel, ConfigDict

from app.domain.models import ResolvedItem, Route
from app.domain.search_text import normalize


class _Fact(BaseModel):
    model_config = ConfigDict(frozen=True)


class SearchMiss(_Fact):
    """A shopper wanted something the catalog doesn't list."""

    store_id: str
    session_id: str
    query: str
    # The department it would belong to, when something could tell.
    category_id: str | None
    timestamp: datetime

    @property
    def query_key(self) -> str:
        return normalize(self.query)


class RouteTrip(_Fact):
    store_id: str
    session_id: str
    edges: tuple[tuple[str, str], ...]
    timestamp: datetime


class CountPair(_Fact):
    """A figure now, and the same figure one week back."""

    current: int
    previous: int


class DashboardCounts(_Fact):
    routes_today: CountPair
    missing_alerts: CountPair
    unfulfilled_searches: CountPair


class MissTally(_Fact):
    query: str
    category_id: str | None
    times: int


class CategoryTally(_Fact):
    category_id: str | None
    times: int


class HeatPoint(_Fact):
    x: float
    y: float
    count: int


class AnalyticsStore(Protocol):
    def record_misses(self, misses: Sequence[SearchMiss]) -> None: ...

    def record_trip(self, trip: RouteTrip) -> None: ...


def edge_key(from_node: str, to_node: str) -> tuple[str, str]:
    """Walkways have no direction, so A to B and B to A are the same stretch of floor."""
    first, second = sorted((from_node, to_node))
    return first, second


def route_edges(route: Route) -> tuple[tuple[str, str], ...]:
    """Every walkway on a route, each once however often it doubles back."""
    return tuple(
        sorted(
            {
                edge_key(a.node_id, b.node_id)
                for leg in route.legs
                for a, b in pairwise(leg.points)
            }
        )
    )


def misses_in(
    items: Sequence[ResolvedItem], store_id: str, session_id: str, at: datetime
) -> list[SearchMiss]:
    """What a resolved list says the store lacks.

    An item with no match is a miss. So is one only Claude could place: it had no
    term in the catalog or the dictionary, so the store can say where such a thing
    would go, but not that it stocks it.
    """
    return [
        SearchMiss(
            store_id=store_id,
            session_id=session_id,
            query=item.text,
            category_id=item.hit.category_id if item.hit else None,
            timestamp=at,
        )
        for item in items
        if normalize(item.text)
        and (item.hit is None or (item.source == "llm" and item.dictionary_id is None))
    ]
