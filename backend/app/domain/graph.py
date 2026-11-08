"""Walkable store graph with precomputed shortest paths."""

import heapq
from collections.abc import Iterable, Mapping
from typing import Self

from app.domain.models import Store


class StoreGraph:
    """An undirected weighted graph, immutable once built.

    Dijkstra runs from every node up front, so each lookup during routing is a
    dict read and the instance is safe to share between requests.
    """

    def __init__(self, node_ids: Iterable[str], edges: Iterable[tuple[str, str, float]]) -> None:
        adjacency: dict[str, list[tuple[str, float]]] = {node_id: [] for node_id in node_ids}
        for from_node, to_node, length_m in edges:
            adjacency[from_node].append((to_node, length_m))
            adjacency[to_node].append((from_node, length_m))

        self._distances: dict[str, dict[str, float]] = {}
        self._previous: dict[str, dict[str, str]] = {}
        for node_id in adjacency:
            distances, previous = _dijkstra(adjacency, node_id)
            if len(distances) != len(adjacency):
                unreachable = sorted(set(adjacency) - set(distances))
                raise ValueError(f"unreachable from {node_id}: {unreachable}")
            self._distances[node_id] = distances
            self._previous[node_id] = previous

    @classmethod
    def from_store(cls, store: Store) -> Self:
        return cls(
            (node.id for node in store.nodes),
            ((edge.from_node, edge.to_node, edge.length_m) for edge in store.edges),
        )

    def distance(self, from_node: str, to_node: str) -> float:
        return self._distances[from_node][to_node]

    def path(self, from_node: str, to_node: str) -> tuple[str, ...]:
        """Node ids from `from_node` to `to_node`, both included."""
        previous = self._previous[from_node]
        nodes = [to_node]
        while nodes[-1] != from_node:
            nodes.append(previous[nodes[-1]])
        return tuple(reversed(nodes))


def _dijkstra(
    adjacency: Mapping[str, list[tuple[str, float]]], source: str
) -> tuple[dict[str, float], dict[str, str]]:
    distances = {source: 0.0}
    previous: dict[str, str] = {}
    queue = [(0.0, source)]

    while queue:
        distance, node_id = heapq.heappop(queue)
        if distance > distances[node_id]:
            continue
        for neighbour, length_m in adjacency[node_id]:
            candidate = distance + length_m
            if candidate < distances.get(neighbour, float("inf")):
                distances[neighbour] = candidate
                previous[neighbour] = node_id
                heapq.heappush(queue, (candidate, neighbour))

    return distances, previous
