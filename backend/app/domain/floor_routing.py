"""Routing a shopper across a floor plan managers drew.

A department is every shelf tile carrying its label. A shopper stops on an open
tile beside one of them, walks the stops in the order `order_stops` finds, and
ends beside a checkout counter. Distances for that order come from one Dijkstra
flood per place; each walk between two places is drawn with A*.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise

from app.domain.floor_plan import (
    Cell,
    FloorGrid,
    FloorPlan,
    distances_from,
    find_path,
    path_length,
)
from app.domain.models import Category, Model
from app.domain.routing import order_stops
from app.domain.search_text import normalize

_START = "@start"
_END = "@end"
_STOP_PREFIX = "department:"
# Floods from shoppers' own positions, kept for re-plans; departments are kept for good.
_MAX_KEPT_STARTS = 64


class FloorPlanProblem(StrEnum):
    """Why no route can be planned on a floor plan. Codes, so the dashboard words them."""

    NO_ENTRANCE = "no_entrance"
    NO_CHECKOUT = "no_checkout"
    CHECKOUT_UNREACHABLE = "checkout_unreachable"


class FloorPlanNotRoutableError(ValueError):
    def __init__(self, problems: Sequence[FloorPlanProblem]) -> None:
        super().__init__(", ".join(problems))
        self.problems = tuple(problems)


class InvalidStartError(ValueError):
    """The position to plan from isn't a tile a shopper can stand on, or is walled off."""


class GridPoint(Model):
    row: int
    col: int


class FloorDepartment(Model):
    label: str
    tiles: int
    # The catalog department it stands for, matched by name; None if nothing matches.
    category_id: str | None
    # False when no open tile beside it can be reached from the entrance.
    reachable: bool


class FloorPlanCheck(Model):
    routable: bool
    problems: tuple[FloorPlanProblem, ...]
    departments: tuple[FloorDepartment, ...]


class GridRouteStop(Model):
    seq: int
    category_id: str
    category_name: str
    category_name_en: str
    department: str
    row: int
    col: int
    leg_index: int


class GridRouteLeg(Model):
    length_m: float
    cells: tuple[GridPoint, ...]


class GridRoute(Model):
    """A walk across the floor plan, shaped like the graph route.

    `legs[stop.leg_index]` ends at that stop and the last leg ends beside a
    checkout. Stops in one department share a leg. `unplaced_category_ids` lists
    what was asked for and isn't on the plan.
    """

    store_id: str
    start: GridPoint
    end: GridPoint
    total_length_m: float
    stops: tuple[GridRouteStop, ...]
    legs: tuple[GridRouteLeg, ...]
    unplaced_category_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Department:
    label: str
    key: str
    shelf_tiles: tuple[Cell, ...]
    # Where the shopper stands: the open tile beside the shelf nearest its middle.
    stop: Cell | None


class GridRouter:
    """Everything routing needs from one floor plan. Built once per saved version."""

    def __init__(self, plan: FloorPlan) -> None:
        self.plan = plan
        self.grid = FloorGrid(plan)
        entrances = plan.cells_of("entrance")
        self.entrance: Cell | None = entrances[0] if entrances else None
        self._reachable = distances_from(self.grid, [self.entrance]) if self.entrance else {}

        counters = plan.cells_of("checkout")
        self._checkout_access = sorted(
            {
                cell
                for counter in counters
                for cell in self.grid.orthogonal_neighbours(counter)
                if cell in self._reachable
            }
        )
        self._to_checkout = distances_from(self.grid, self._checkout_access)

        problems: list[FloorPlanProblem] = []
        if self.entrance is None:
            problems.append(FloorPlanProblem.NO_ENTRANCE)
        if not counters:
            problems.append(FloorPlanProblem.NO_CHECKOUT)
        elif self.entrance is not None and not self._checkout_access:
            problems.append(FloorPlanProblem.CHECKOUT_UNREACHABLE)
        self.problems = tuple(problems)

        self._departments = self._find_departments()
        self._by_key = {department.key: department for department in self._departments}
        self._department_stops = {d.stop for d in self._departments if d.stop is not None}
        self._floods: dict[Cell, dict[Cell, float]] = {}
        self._start_floods: dict[Cell, dict[Cell, float]] = {}

    @property
    def routable(self) -> bool:
        return not self.problems

    def check(self, categories: Iterable[Category]) -> FloorPlanCheck:
        """What a manager should know about the plan before shoppers walk it."""
        linked: dict[str, str] = {}
        for category in categories:
            for name in _names(category):
                linked.setdefault(normalize(name), category.id)
        return FloorPlanCheck(
            routable=self.routable,
            problems=self.problems,
            departments=tuple(
                FloorDepartment(
                    label=department.label,
                    tiles=len(department.shelf_tiles),
                    category_id=linked.get(department.key),
                    reachable=department.stop is not None,
                )
                for department in self._departments
            ),
        )

    def plan_route(
        self,
        store_id: str,
        category_ids: Sequence[str],
        categories: Mapping[str, Category],
        start: Cell | None = None,
    ) -> GridRoute:
        """Route through `category_ids` to the checkout, from `start` or the entrance."""
        if not self.routable or self.entrance is None:
            raise FloorPlanNotRoutableError(self.problems)
        origin = start or self.entrance
        if origin not in self._reachable:
            raise InvalidStartError(f"Not an open tile reachable from the entrance: {origin}")

        stops_by_label: dict[str, list[Category]] = {}
        unplaced: list[str] = []
        for category_id in dict.fromkeys(category_ids):
            category = categories.get(category_id)
            department = self._department_for(category, categories) if category else None
            if department is None or department.stop is None:
                unplaced.append(category_id)
                continue
            stops_by_label.setdefault(department.label, []).append(category)

        stop_cells = {
            department.label: department.stop
            for department in self._departments
            if department.label in stops_by_label and department.stop is not None
        }
        distances = _Distances(self, origin, {
            f"{_STOP_PREFIX}{label}": cell for label, cell in stop_cells.items()
        })
        order = [
            stop_id.removeprefix(_STOP_PREFIX)
            for stop_id in order_stops(distances, _START, list(distances.cells), _END)
        ]

        places = [origin, *(stop_cells[label] for label in order)]
        flood_from_last = self.flood(places[-1])
        end = min(self._checkout_access, key=lambda cell: (flood_from_last[cell], cell))
        places.append(end)

        size = self.plan.cell_size_m
        legs = tuple(self._leg(a, b, size) for a, b in pairwise(places))
        stops = tuple(
            GridRouteStop(
                seq=seq,
                category_id=category.id,
                category_name=category.name,
                category_name_en=category.name_en,
                department=label,
                row=stop_cells[label][0],
                col=stop_cells[label][1],
                leg_index=leg_index,
            )
            for seq, (leg_index, label, category) in enumerate(
                (leg_index, label, category)
                for leg_index, label in enumerate(order)
                for category in stops_by_label[label]
            )
        )
        return GridRoute(
            store_id=store_id,
            start=GridPoint(row=origin[0], col=origin[1]),
            end=GridPoint(row=end[0], col=end[1]),
            total_length_m=round(sum(leg.length_m for leg in legs), 2),
            stops=stops,
            legs=legs,
            unplaced_category_ids=tuple(unplaced),
        )

    def distance_to_checkout(self, cell: Cell) -> float:
        return self._to_checkout[cell]

    def flood(self, cell: Cell) -> dict[Cell, float]:
        """Distances from one place, kept: departments come back in every route."""
        kept = self._floods.get(cell) or self._start_floods.get(cell)
        if kept is None:
            kept = distances_from(self.grid, [cell])
            if cell in self._department_stops:
                self._floods[cell] = kept
            else:
                if len(self._start_floods) >= _MAX_KEPT_STARTS:
                    self._start_floods.pop(next(iter(self._start_floods)))
                self._start_floods[cell] = kept
        return kept

    def _leg(self, from_cell: Cell, to_cell: Cell, size: float) -> GridRouteLeg:
        path = find_path(self.grid, from_cell, to_cell)
        if path is None:  # Can't happen: both ends are in the entrance's area.
            raise InvalidStartError(f"No walk from {from_cell} to {to_cell}")
        return GridRouteLeg(
            length_m=round(path_length(path) * size, 2),
            cells=tuple(GridPoint(row=row, col=col) for row, col in path),
        )

    def _department_for(
        self, category: Category, categories: Mapping[str, Category]
    ) -> _Department | None:
        """By name: a placed product goes where its department is drawn."""
        owner = categories.get(category.department_id) if category.department_id else None
        for candidate in (category, owner):
            if candidate is None:
                continue
            for name in _names(candidate):
                department = self._by_key.get(normalize(name))
                if department is not None:
                    return department
        return None

    def _find_departments(self) -> tuple[_Department, ...]:
        """One per name as search reads it, so "Dairy" and "dairy" are one department."""
        tiles_by_key: dict[str, list[Cell]] = {}
        labels_by_key: dict[str, list[str]] = {}
        for entry in self.plan.labels:
            key = normalize(entry.label)
            tiles_by_key.setdefault(key, []).append((entry.row, entry.col))
            labels_by_key.setdefault(key, []).append(entry.label)
        departments = (
            _Department(
                # The spelling most of its tiles carry.
                label=max(sorted(set(labels)), key=labels.count),
                key=key,
                shelf_tiles=tuple(sorted(tiles_by_key[key])),
                stop=self._stop_beside(tiles_by_key[key]),
            )
            for key, labels in labels_by_key.items()
        )
        return tuple(sorted(departments, key=lambda department: department.label))

    def _stop_beside(self, shelf_tiles: Sequence[Cell]) -> Cell | None:
        """The open tile beside the shelf closest to its middle, reachable from the entrance."""
        beside = {
            cell
            for tile in shelf_tiles
            for cell in self.grid.orthogonal_neighbours(tile)
            if cell in self._reachable
        }
        if not beside:
            return None
        middle_row = sum(row for row, _ in shelf_tiles) / len(shelf_tiles)
        middle_col = sum(col for _, col in shelf_tiles) / len(shelf_tiles)
        return min(
            beside,
            key=lambda cell: ((cell[0] - middle_row) ** 2 + (cell[1] - middle_col) ** 2, cell),
        )


class _Distances:
    """The walking distances `order_stops` asks for, by place id, in one table.

    Ordering asks for the same few pairs hundreds of thousands of times, so each
    is looked up once here. The end is "beside whichever checkout is nearest",
    so its distances come from one flood out of every checkout at once.
    """

    def __init__(self, router: GridRouter, origin: Cell, stops: dict[str, Cell]) -> None:
        self.cells = stops
        places = {_START: origin, **stops}
        self._table: dict[tuple[str, str], float] = {(_END, _END): 0.0}
        for name, cell in places.items():
            flood = router.flood(cell)
            to_end = router.distance_to_checkout(cell)
            self._table[(name, _END)] = self._table[(_END, name)] = to_end
            for other, other_cell in places.items():
                self._table[(name, other)] = flood[other_cell]

    def distance(self, from_node: str, to_node: str) -> float:
        return self._table[(from_node, to_node)]


def _names(category: Category) -> tuple[str, ...]:
    return (category.name, category.name_en, *category.aliases)
