"""A store's floor as managers draw it in the dashboard: square tiles, and walking on them.

The grid is `tiles[row][col]`, row 0 at the top, the shape the dashboard's editor
saves. A shopper can stand on an aisle or the entrance; shelves, walls and
checkout counters are in the way.
"""

import heapq
import math
from collections.abc import Iterable, Iterator
from typing import Literal, Self

from pydantic import Field, field_validator, model_validator

from app.domain.models import Model

TileKind = Literal["aisle", "shelf", "wall", "checkout", "entrance"]
Cell = tuple[int, int]

WALKABLE: frozenset[str] = frozenset({"aisle", "entrance"})
MIN_SIZE = 5
MAX_SIZE = 60
MAX_LABEL_LENGTH = 40
FLOOR_PLAN_VERSION = 1

_DIAGONAL = math.sqrt(2)
_STEPS: tuple[tuple[int, int, float], ...] = (
    (-1, 0, 1.0),
    (1, 0, 1.0),
    (0, -1, 1.0),
    (0, 1, 1.0),
    (-1, -1, _DIAGONAL),
    (-1, 1, _DIAGONAL),
    (1, -1, _DIAGONAL),
    (1, 1, _DIAGONAL),
)
_EPSILON = 1e-9


class ShelfLabel(Model):
    """The department on one shelf tile."""

    row: int = Field(ge=0)
    col: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=MAX_LABEL_LENGTH)

    @field_validator("label")
    @classmethod
    def _clean(cls, label: str) -> str:
        """Spaced the way the editor spaces it, so one department is one label."""
        cleaned = " ".join(label.split())
        if not cleaned:
            raise ValueError("a label can't be blank")
        return cleaned


class FloorPlan(Model):
    """What the editor saves, checked: the right shape, known tiles, labels on shelves."""

    version: Literal[1]
    rows: int = Field(ge=MIN_SIZE, le=MAX_SIZE)
    cols: int = Field(ge=MIN_SIZE, le=MAX_SIZE)
    tiles: tuple[tuple[TileKind, ...], ...]
    labels: tuple[ShelfLabel, ...] = ()
    # A tile's side on the real floor. The editor has no ruler yet, so a metre.
    cell_size_m: float = Field(default=1.0, gt=0, le=5)

    @model_validator(mode="after")
    def _check_shape(self) -> Self:
        if len(self.tiles) != self.rows or any(len(line) != self.cols for line in self.tiles):
            raise ValueError(f"tiles must be {self.rows} rows of {self.cols}")
        seen: set[Cell] = set()
        for entry in self.labels:
            cell = (entry.row, entry.col)
            if entry.row >= self.rows or entry.col >= self.cols:
                raise ValueError(f"label outside the grid at {cell}")
            if self.tiles[entry.row][entry.col] != "shelf":
                raise ValueError(f"label on a tile that isn't a shelf at {cell}")
            if cell in seen:
                raise ValueError(f"two labels on one tile at {cell}")
            seen.add(cell)
        return self

    def cells_of(self, kind: TileKind) -> list[Cell]:
        """Every tile of one kind, in reading order."""
        return [
            (row, col)
            for row, line in enumerate(self.tiles)
            for col, tile in enumerate(line)
            if tile == kind
        ]


class FloorGrid:
    """Which tiles a shopper can stand on, and how they connect.

    Moves go to all eight neighbours. A diagonal step needs both tiles beside
    it open, so a route never squeezes between two shelf corners. Each tile's
    moves are worked out once, since every search asks for them thousands of times.
    """

    def __init__(self, plan: FloorPlan) -> None:
        self.rows = plan.rows
        self.cols = plan.cols
        self._open = [[tile in WALKABLE for tile in line] for line in plan.tiles]
        self._moves: dict[Cell, tuple[tuple[Cell, float], ...]] = {
            (row, col): tuple(self._moves_from(row, col))
            for row in range(self.rows)
            for col in range(self.cols)
            if self._open[row][col]
        }

    def is_walkable(self, cell: Cell) -> bool:
        row, col = cell
        return 0 <= row < self.rows and 0 <= col < self.cols and self._open[row][col]

    def neighbours(self, cell: Cell) -> tuple[tuple[Cell, float], ...]:
        return self._moves.get(cell, ())

    def orthogonal_neighbours(self, cell: Cell) -> Iterator[Cell]:
        """Open tiles next to `cell`, not across a corner: where a shopper reaches a shelf from."""
        row, col = cell
        for target in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
            if self.is_walkable(target):
                yield target

    def _moves_from(self, row: int, col: int) -> Iterator[tuple[Cell, float]]:
        for d_row, d_col, cost in _STEPS:
            target = (row + d_row, col + d_col)
            if not self.is_walkable(target):
                continue
            if d_row and d_col and not (
                self.is_walkable((row + d_row, col)) and self.is_walkable((row, col + d_col))
            ):
                continue
            yield target, cost


def octile(a: Cell, b: Cell) -> float:
    """The shortest possible walk with eight-way moves and nothing in the way.

    Never more than the real walk, which is what keeps A* exact.
    """
    d_row = abs(a[0] - b[0])
    d_col = abs(a[1] - b[1])
    return max(d_row, d_col) + (_DIAGONAL - 1) * min(d_row, d_col)


def find_path(grid: FloorGrid, start: Cell, goal: Cell) -> tuple[Cell, ...] | None:
    """The shortest walk from `start` to `goal`, both included, by A*; None if walled off.

    Ties go the same way every time, so the same request draws the same line.
    """
    if not (grid.is_walkable(start) and grid.is_walkable(goal)):
        return None
    best = {start: 0.0}
    came_from: dict[Cell, Cell] = {}
    # Equal estimates go to the tile walked furthest, which reaches the goal sooner.
    queue: list[tuple[float, float, Cell]] = [(octile(start, goal), 0.0, start)]
    while queue:
        _, negative_cost, cell = heapq.heappop(queue)
        cost = -negative_cost
        if cell == goal:
            return _walk_back(came_from, start, goal)
        if cost > best[cell] + _EPSILON:
            continue
        for target, step in grid.neighbours(cell):
            candidate = cost + step
            if candidate < best.get(target, math.inf) - _EPSILON:
                best[target] = candidate
                came_from[target] = cell
                heapq.heappush(queue, (candidate + octile(target, goal), -candidate, target))
    return None


def distances_from(grid: FloorGrid, sources: Iterable[Cell]) -> dict[Cell, float]:
    """Walking distance from the nearest source to every tile it can reach (Dijkstra).

    One of these answers every "how far" from a place at once, where A* answers one pair.
    """
    distances: dict[Cell, float] = {}
    queue: list[tuple[float, Cell]] = []
    for source in sources:
        if grid.is_walkable(source) and source not in distances:
            distances[source] = 0.0
            queue.append((0.0, source))
    heapq.heapify(queue)
    while queue:
        cost, cell = heapq.heappop(queue)
        if cost > distances[cell] + _EPSILON:
            continue
        for target, step in grid.neighbours(cell):
            candidate = cost + step
            if candidate < distances.get(target, math.inf) - _EPSILON:
                distances[target] = candidate
                heapq.heappush(queue, (candidate, target))
    return distances


def path_length(path: Iterable[Cell]) -> float:
    """In tiles: one per straight step, √2 per diagonal."""
    cells = list(path)
    return sum(
        _DIAGONAL if a[0] != b[0] and a[1] != b[1] else 1.0
        for a, b in zip(cells, cells[1:], strict=False)
    )


def _walk_back(came_from: dict[Cell, Cell], start: Cell, goal: Cell) -> tuple[Cell, ...]:
    cells = [goal]
    while cells[-1] != start:
        cells.append(came_from[cells[-1]])
    return tuple(reversed(cells))
