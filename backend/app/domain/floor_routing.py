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
from app.domain.analytics import edge_key
from app.domain.models import Category, Model
from app.domain.routing import order_stops
from app.domain.search_text import normalize

CELL_PREFIX = "cell:"
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
    # Set when the name is one of that department's subcategories, a shelf finer than it.
    subcategory: str | None = None
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


# Joins the places a split department may use into one stop's key; no label holds it.
_GROUP = "\u241f"


@dataclass(frozen=True)
class _Department:
    label: str
    key: str
    shelf_tiles: tuple[Cell, ...]
    # Where the shopper stands: the open tile beside the shelf nearest its middle.
    stop: Cell | None
    # One such tile on each side of the shelf a shopper can reach; `stop` is among them.
    sides: tuple[Cell, ...] = ()


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

    def placements(
        self,
        categories: Mapping[str, Category],
        subcategories: Mapping[str, Sequence[str]] | None = None,
    ) -> dict[str, str]:
        """The drawn place every category and placed product would be routed to.

        The same matching a route uses, so the shopper apps can say where something
        stands without repeating it. A department drawn only as its subcategories
        names the first of them; the route itself goes to whichever it passes best.
        Anything not drawn, or walled off, is absent.
        """
        found: dict[str, str] = {}
        for category in categories.values():
            areas = self._areas_for(category, categories, subcategories or {})
            if areas:
                found[category.id] = areas[0].label
        return found

    def check(
        self,
        categories: Iterable[Category],
        subcategories: Mapping[str, Sequence[str]] | None = None,
    ) -> FloorPlanCheck:
        """What a manager should know about the plan before shoppers walk it."""
        # A department's own names first, then its subcategories, and search's
        # aliases last: produce's alias "פירות" is also its fruit subcategory.
        targets = list(categories)
        linked: dict[str, tuple[str, str | None]] = {}
        for category in targets:
            for name in _own_names(category):
                linked.setdefault(normalize(name), (category.id, None))
        for department_id, names in (subcategories or {}).items():
            for name in names:
                linked.setdefault(normalize(name), (department_id, name))
        for category in targets:
            for name in category.aliases:
                linked.setdefault(normalize(name), (category.id, None))
        return FloorPlanCheck(
            routable=self.routable,
            problems=self.problems,
            departments=tuple(
                FloorDepartment(
                    label=department.label,
                    tiles=len(department.shelf_tiles),
                    category_id=linked.get(department.key, (None, None))[0],
                    subcategory=linked.get(department.key, (None, None))[1],
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
        subcategories: Mapping[str, Sequence[str]] | None = None,
    ) -> GridRoute:
        """Route through `category_ids` to the checkout, from `start` or the entrance.

        Each goes to the most specific place drawn for it: a product's own shelf,
        its subcategory's, then its department's. A department drawn only as its
        subcategories goes to whichever of them the walk passes best.
        """
        if not self.routable or self.entrance is None:
            raise FloorPlanNotRoutableError(self.problems)
        origin = start or self.entrance
        if origin not in self._reachable:
            raise InvalidStartError(f"Not an open tile reachable from the entrance: {origin}")

        # One stop per drawn place, or per set of places a split department may use.
        stops_by_label: dict[str, list[Category]] = {}
        areas_of: dict[str, tuple[_Department, ...]] = {}
        unplaced: list[str] = []
        for category_id in dict.fromkeys(category_ids):
            category = categories.get(category_id)
            areas = self._areas_for(category, categories, subcategories or {}) if category else ()
            if not areas:
                unplaced.append(category_id)
                continue
            key = areas[0].label if len(areas) == 1 else _GROUP.join(area.label for area in areas)
            areas_of[key] = areas
            stops_by_label.setdefault(key, []).append(category)

        start_flood = self.flood(origin)
        stop_cells = {
            # Of several places, the one nearest where the walk starts; sides refine it below.
            key: min((area.stop for area in areas if area.stop), key=lambda cell: (start_flood[cell], cell))
            for key, areas in areas_of.items()
        }
        distances = _Distances(self, origin, {
            f"{_STOP_PREFIX}{label}": cell for label, cell in stop_cells.items()
        })
        order = [
            stop_id.removeprefix(_STOP_PREFIX)
            for stop_id in order_stops(distances, _START, list(distances.cells), _END)
        ]

        sides = {
            key: tuple(dict.fromkeys(cell for area in areas for cell in area.sides))
            for key, areas in areas_of.items()
        }
        self._choose_sides(origin, order, stop_cells, sides)
        # The drawn place each stop ended at, which the apps name and light up.
        reached = {
            key: next(
                (area.label for area in areas if stop_cells[key] in (area.stop, *area.sides)),
                areas[0].label,
            )
            for key, areas in areas_of.items()
        }
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
                department=reached[label],
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

    def stop_for(self, label: str) -> Cell | None:
        """Where a shopper stands for the shelf drawn as `label`, or None: not drawn, or walled off."""
        area = self._by_key.get(normalize(label))
        return area.stop if area is not None else None

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

    def _choose_sides(
        self,
        origin: Cell,
        order: list[str],
        stop_cells: dict[str, Cell],
        sides: Mapping[str, Sequence[Cell]],
    ) -> None:
        """Moves each stop to the side of its shelf the walk passes, in place.

        The order is found with each department's middle tile; a shelf can also
        be reached from its other side, and walking round it to the far one is
        what a shopper would notice. A split department's stop may move to any side
        of any of its places. Each pass keeps a change only if it shortens the way
        in from the stop before plus the way on to the next.
        """
        for _ in range(3):
            changed = False
            for index, label in enumerate(order):
                previous = origin if index == 0 else stop_cells[order[index - 1]]
                following = stop_cells[order[index + 1]] if index + 1 < len(order) else None
                walks = {
                    cell: self._walk_through(cell, previous, following) for cell in sides[label]
                }
                best = min(walks, key=lambda cell: (round(walks[cell], 6), cell))
                current = self._walk_through(stop_cells[label], previous, following)
                if walks[best] < current - 1e-9:
                    stop_cells[label] = best
                    changed = True
            if not changed:
                return

    def _walk_through(self, cell: Cell, previous: Cell, following: Cell | None) -> float:
        """From `previous` to `cell`, then on to `following`, or to a till when it is last."""
        onward = (
            self.flood(following)[cell] if following else self.distance_to_checkout(cell)
        )
        return self.flood(previous)[cell] + onward

    def _leg(self, from_cell: Cell, to_cell: Cell, size: float) -> GridRouteLeg:
        path = find_path(self.grid, from_cell, to_cell)
        if path is None:  # Can't happen: both ends are in the entrance's area.
            raise InvalidStartError(f"No walk from {from_cell} to {to_cell}")
        return GridRouteLeg(
            length_m=round(path_length(path) * size, 2),
            cells=tuple(GridPoint(row=row, col=col) for row, col in path),
        )

    def _areas_for(
        self,
        category: Category,
        categories: Mapping[str, Category],
        subcategories: Mapping[str, Sequence[str]],
    ) -> tuple[_Department, ...]:
        """Where a shopper is sent for `category`, by name, the most specific place first.

        A placed product's own name, then its subcategory, then its department. A
        department not drawn under its own name but drawn as its subcategories has
        all of those, for the route to choose between; search's aliases come last,
        since produce's alias "פירות" is also the name of just its fruit. Walled-off
        places don't count, so a finer one that can't be reached falls back.
        """

        def drawn(names: Iterable[str]) -> tuple[_Department, ...]:
            found = (self._by_key.get(normalize(name)) for name in names)
            return tuple(dict.fromkeys(area for area in found if area is not None and area.stop is not None))

        if category.department_id is not None:
            owner = categories.get(category.department_id)
            levels: list[Iterable[str]] = [_names(category)]
            if category.subcategory:
                levels.append((category.subcategory,))
            if owner is not None:
                levels += [_own_names(owner), owner.aliases]
            for names in levels:
                if areas := drawn(names):
                    return areas[:1]
            return ()
        if areas := drawn(_own_names(category)):
            return areas[:1]
        if areas := drawn(subcategories.get(category.id, ())):
            return areas
        return drawn(category.aliases)[:1]

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
                sides=self._sides_of(tiles_by_key[key]),
            )
            for key, labels in labels_by_key.items()
        )
        return tuple(sorted(departments, key=lambda department: department.label))

    def _sides_of(self, shelf_tiles: Sequence[Cell]) -> tuple[Cell, ...]:
        """For each of the four sides, the reachable open tile there nearest the shelf's middle."""
        middle_row = sum(row for row, _ in shelf_tiles) / len(shelf_tiles)
        middle_col = sum(col for _, col in shelf_tiles) / len(shelf_tiles)
        found: list[Cell] = []
        for d_row, d_col in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            beside = {
                (row + d_row, col + d_col)
                for row, col in shelf_tiles
                if (row + d_row, col + d_col) in self._reachable
            }
            if beside:
                found.append(
                    min(
                        beside,
                        key=lambda cell: (
                            (cell[0] - middle_row) ** 2 + (cell[1] - middle_col) ** 2,
                            cell,
                        ),
                    )
                )
        return tuple(dict.fromkeys(found))

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


def cell_id(row: int, col: int) -> str:
    """A tile as analytics name a place: the graph's nodes and the plan's tiles share a table."""
    return f"{CELL_PREFIX}{row}:{col}"


def grid_route_edges(route: GridRoute) -> tuple[tuple[str, str], ...]:
    """Every step between two tiles on a route, each once however often it doubles back."""
    steps = {
        edge_key(cell_id(a.row, a.col), cell_id(b.row, b.col))
        for leg in route.legs
        for a, b in pairwise(leg.cells)
    }
    return tuple(sorted(steps))


def _names(category: Category) -> tuple[str, ...]:
    return (category.name, category.name_en, *category.aliases)


def _own_names(category: Category) -> tuple[str, ...]:
    """Its names without search's aliases, which may be narrower than it."""
    return (category.name, category.name_en)
