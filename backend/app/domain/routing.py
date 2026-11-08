"""Stop ordering for a walk from a fixed start to a fixed end."""

from collections.abc import Collection
from itertools import pairwise
from typing import Protocol

_EPSILON = 1e-9
_MAX_MOVED_SEGMENT = 3


class Distances(Protocol):
    """Walking distance between two places, the same both ways.

    The store's node graph is one; a manager's tile floor plan is another.
    """

    def distance(self, from_node: str, to_node: str) -> float: ...


def order_stops(
    graph: Distances, start: str, stops: Collection[str], end: str
) -> list[str]:
    """Order `stops` for a short walk from `start` to `end`.

    Builds one nearest-neighbour tour per possible first stop, improves each
    with 2-opt and or-opt, and keeps the shortest. A single start gets stuck in
    aisle layouts: one early choice can commit the walk to the wrong aisle.
    Results are deterministic: ties go to the lowest node id.
    """
    if not stops:
        return []
    tours = (_improved_tour(graph, start, first, stops, end) for first in sorted(stops))
    return min(tours, key=lambda tour: _tour_length(graph, tour))[1:-1]


def _improved_tour(
    graph: Distances, start: str, first: str, stops: Collection[str], end: str
) -> list[str]:
    tour = [start, *_nearest_neighbour(graph, first, stops), end]
    while _two_opt_pass(graph, tour) or _or_opt_pass(graph, tour):
        pass
    return tour


def _tour_length(graph: Distances, tour: list[str]) -> float:
    return sum(graph.distance(a, b) for a, b in pairwise(tour))


def _nearest_neighbour(graph: Distances, first: str, stops: Collection[str]) -> list[str]:
    remaining = set(stops) - {first}
    order = [first]
    while remaining:
        current = min(remaining, key=lambda node_id: (graph.distance(order[-1], node_id), node_id))
        remaining.remove(current)
        order.append(current)
    return order


def _two_opt_pass(graph: Distances, tour: list[str]) -> bool:
    """Reverse segments that shorten `tour`, in place. Its ends stay fixed.

    A reversal only changes the two edges around the segment. That holds
    because the graph is undirected, so the segment's inside keeps its length.
    """
    distance = graph.distance
    improved = False
    for first in range(1, len(tour) - 2):
        for last in range(first + 1, len(tour) - 1):
            current = distance(tour[first - 1], tour[first]) + distance(tour[last], tour[last + 1])
            swapped = distance(tour[first - 1], tour[last]) + distance(tour[first], tour[last + 1])
            if swapped < current - _EPSILON:
                tour[first : last + 1] = reversed(tour[first : last + 1])
                improved = True
    return improved


def _or_opt_pass(graph: Distances, tour: list[str]) -> bool:
    """Move the first short segment that shortens `tour`, in place."""
    distance = graph.distance
    for size in range(1, _MAX_MOVED_SEGMENT + 1):
        for first in range(1, len(tour) - size):
            after = first + size
            segment = tour[first:after]
            rest = tour[:first] + tour[after:]
            saved = (
                distance(tour[first - 1], segment[0])
                + distance(segment[-1], tour[after])
                - distance(tour[first - 1], tour[after])
            )
            for position in range(1, len(rest)):
                if position == first:
                    continue
                before, next_node = rest[position - 1], rest[position]
                for candidate in (segment, segment[::-1]):
                    added = (
                        distance(before, candidate[0])
                        + distance(candidate[-1], next_node)
                        - distance(before, next_node)
                    )
                    if added < saved - _EPSILON:
                        tour[:] = rest[:position] + candidate + rest[position:]
                        return True
    return False
