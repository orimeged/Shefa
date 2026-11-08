"""Routing a shopper across a floor plan a manager drew."""

import itertools
import time

import pytest

from app.domain.floor_plan import FloorGrid, distances_from, find_path, path_length
from app.domain.floor_routing import (
    FloorPlanNotRoutableError,
    FloorPlanProblem,
    GridRoute,
    GridRouter,
    InvalidStartError,
)
from app.domain.models import Category
from tests.floor_plans import plan_from


def category(id_: str, name: str, name_en: str = "", *aliases: str, department_id: str | None = None) -> Category:
    return Category(
        id=id_,
        name=name,
        name_en=name_en or id_,
        section_id="unused",
        aliases=aliases,
        department_id=department_id,
    )


CATALOG = {
    c.id: c
    for c in (
        category("dairy", "מוצרי חלב", "Dairy"),
        category("bakery", "לחם ומאפים", "Bakery", "לחמים"),
        category("coffee", "קפה ותה", "Coffee & Tea"),
        category("produce", "פירות וירקות", "Produce"),
        category("frozen", "קפואים", "Frozen"),
        category("product-7", "חלב 3%", "Milk 3%", department_id="dairy"),
    )
}

# Three shelves along the top, a long one at the bottom; door at bottom left, tills at bottom right.
STORE = [
    "##########",
    "#........#",
    "#.dd.bb..#",
    "#........#",
    "#.cc..pp.#",
    "#........#",
    "#........#",
    "E......CC#",
]
LABELS = {"d": "מוצרי חלב", "b": "Bakery", "c": "קפה ותה", "p": "פירות וירקות"}


@pytest.fixture(scope="module")
def router() -> GridRouter:
    return GridRouter(plan_from(STORE, LABELS))


def assert_walkable_and_connected(route: GridRoute, router: GridRouter) -> None:
    previous_end = (route.start.row, route.start.col)
    for leg in route.legs:
        cells = [(point.row, point.col) for point in leg.cells]
        assert cells[0] == previous_end
        assert all(router.grid.is_walkable(cell) for cell in cells)
        for a, b in itertools.pairwise(cells):
            assert max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1
        previous_end = cells[-1]
    assert previous_end == (route.end.row, route.end.col)


def test_a_route_starts_at_the_door_visits_each_department_and_ends_at_a_till(
    router: GridRouter,
) -> None:
    route = router.plan_route("demo", ["dairy", "coffee", "produce"], CATALOG)

    assert (route.start.row, route.start.col) == (7, 0)
    assert {stop.category_id for stop in route.stops} == {"dairy", "coffee", "produce"}
    assert route.unplaced_category_ids == ()
    assert len(route.legs) == len(route.stops) + 1
    # It ends on an open tile beside a checkout counter.
    end = (route.end.row, route.end.col)
    assert router.grid.is_walkable(end)
    assert any(
        router.plan.tiles[end[0] + dr][end[1] + dc] == "checkout"
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
        if 0 <= end[0] + dr < router.plan.rows and 0 <= end[1] + dc < router.plan.cols
    )
    assert_walkable_and_connected(route, router)
    assert route.total_length_m == pytest.approx(sum(leg.length_m for leg in route.legs), abs=0.01)


def test_each_stop_stands_beside_its_own_shelf(router: GridRouter) -> None:
    route = router.plan_route("demo", ["dairy", "bakery", "coffee", "produce"], CATALOG)
    for stop in route.stops:
        beside = {
            (stop.row + dr, stop.col + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
        }
        shelves = {
            (entry.row, entry.col) for entry in router.plan.labels if entry.label == stop.department
        }
        assert beside & shelves, stop
        assert router.grid.is_walkable((stop.row, stop.col))
        # And its leg ends there.
        last = route.legs[stop.leg_index].cells[-1]
        assert (last.row, last.col) == (stop.row, stop.col)


def test_the_order_is_the_shortest_one(router: GridRouter) -> None:
    """Four stops is few enough to try every order and compare."""
    wanted = ["produce", "dairy", "coffee", "bakery"]
    route = router.plan_route("demo", wanted, CATALOG)
    stops = {stop.department: (stop.row, stop.col) for stop in route.stops}
    door = (route.start.row, route.start.col)
    grid = router.grid
    floods = {cell: distances_from(grid, [cell]) for cell in [door, *stops.values()]}

    def length(order: tuple[tuple[int, int], ...]) -> float:
        walk = sum(floods[a][b] for a, b in itertools.pairwise((door, *order)))
        return walk + router.distance_to_checkout(order[-1])

    best = min(length(order) for order in itertools.permutations(stops.values()))
    # Lengths are given to the centimetre.
    assert route.total_length_m == pytest.approx(best, abs=0.02)


def test_each_leg_is_the_shortest_walk_between_its_ends(router: GridRouter) -> None:
    route = router.plan_route("demo", ["bakery", "coffee"], CATALOG)
    for leg in route.legs:
        start = (leg.cells[0].row, leg.cells[0].col)
        end = (leg.cells[-1].row, leg.cells[-1].col)
        assert leg.length_m == pytest.approx(distances_from(router.grid, [start])[end], abs=0.01)


def test_names_match_in_either_language_by_alias_and_loosely(router: GridRouter) -> None:
    # "Bakery" is drawn in English; the catalog's Hebrew alias and odd casing still find it.
    catalog = {**CATALOG, "bread": category("bread", "לחמים", "BAKERY")}
    route = router.plan_route("demo", ["bakery", "bread"], catalog)
    assert {stop.department for stop in route.stops} == {"Bakery"}


def test_two_items_in_one_department_share_its_stop(router: GridRouter) -> None:
    route = router.plan_route("demo", ["dairy", "product-7"], CATALOG)

    assert [stop.category_id for stop in route.stops] == ["dairy", "product-7"]
    assert route.stops[0].leg_index == route.stops[1].leg_index == 0
    assert (route.stops[0].row, route.stops[0].col) == (route.stops[1].row, route.stops[1].col)
    assert len(route.legs) == 2


def test_what_isnt_drawn_is_reported_not_dropped_silently(router: GridRouter) -> None:
    route = router.plan_route("demo", ["frozen", "dairy", "no-such-id"], CATALOG)
    assert route.unplaced_category_ids == ("frozen", "no-such-id")
    assert [stop.category_id for stop in route.stops] == ["dairy"]


def test_an_empty_list_walks_straight_to_the_till(router: GridRouter) -> None:
    route = router.plan_route("demo", [], CATALOG)
    assert route.stops == ()
    assert len(route.legs) == 1
    assert_walkable_and_connected(route, router)


def test_a_re_plan_starts_where_the_shopper_stands(router: GridRouter) -> None:
    route = router.plan_route("demo", ["coffee"], CATALOG, start=(3, 5))
    assert (route.start.row, route.start.col) == (3, 5)
    assert route.legs[0].cells[0].row == 3
    assert_walkable_and_connected(route, router)


@pytest.mark.parametrize("start", [(0, 0), (2, 2), (7, 7), (40, 40)])
def test_a_re_plan_from_a_wall_a_shelf_a_till_or_outside_is_refused(
    router: GridRouter, start: tuple[int, int]
) -> None:
    with pytest.raises(InvalidStartError):
        router.plan_route("demo", ["coffee"], CATALOG, start=start)


def test_the_till_nearest_the_last_stop_ends_the_route() -> None:
    router = GridRouter(
        plan_from(
            [
                "C........C",
                "..........",
                "..dd......",
                "..........",
                "E.........",
            ],
            {"d": "מוצרי חלב"},
        )
    )
    route = router.plan_route("demo", ["dairy"], CATALOG)
    # The left till, a few steps from the dairy shelf, not the far right one.
    assert route.end.col <= 1


def test_a_department_nobody_can_reach_is_unplaced_and_flagged() -> None:
    router = GridRouter(
        plan_from(
            [
                "E.....###",
                "......#d#",
                "......###",
                ".........",
                "........C",
            ],
            {"d": "מוצרי חלב"},
        )
    )
    route = router.plan_route("demo", ["dairy"], CATALOG)
    assert route.unplaced_category_ids == ("dairy",)
    [dairy] = router.check(CATALOG.values()).departments
    assert dairy.reachable is False


def test_the_check_links_departments_to_the_catalog(router: GridRouter) -> None:
    check = router.check(CATALOG.values())
    assert check.routable
    assert check.problems == ()
    assert [(d.label, d.category_id, d.tiles, d.reachable) for d in check.departments] == [
        ("Bakery", "bakery", 2, True),
        ("מוצרי חלב", "dairy", 2, True),
        ("פירות וירקות", "produce", 2, True),
        ("קפה ותה", "coffee", 2, True),
    ]


def test_a_department_the_catalog_doesnt_know_is_left_unlinked() -> None:
    router = GridRouter(
        plan_from(["E....", ".kk..", ".....", ".....", "....C"], {"k": "קומבוצה"})
    )
    [department] = router.check(CATALOG.values()).departments
    assert department.category_id is None


def test_one_name_spelled_two_ways_is_one_department() -> None:
    router = GridRouter(
        plan_from(
            ["E....", ".dD..", ".....", ".....", "....C"],
            {"d": "Dairy", "D": "dairy"},
        )
    )
    [department] = router.check(CATALOG.values()).departments
    assert department.tiles == 2
    assert department.category_id == "dairy"


@pytest.mark.parametrize(
    ("rows", "problems"),
    [
        ([".....", ".dd..", ".....", ".....", "....C"], [FloorPlanProblem.NO_ENTRANCE]),
        (["E....", ".dd..", ".....", ".....", "....."], [FloorPlanProblem.NO_CHECKOUT]),
        (["E....", ".dd..", ".....", "...##", "...#C"], [FloorPlanProblem.CHECKOUT_UNREACHABLE]),
    ],
)
def test_a_plan_without_a_way_in_or_out_cant_route(
    rows: list[str], problems: list[FloorPlanProblem]
) -> None:
    router = GridRouter(plan_from(rows, {"d": "מוצרי חלב"}))
    assert router.check(CATALOG.values()).problems == tuple(problems)
    assert router.routable is False
    with pytest.raises(FloorPlanNotRoutableError) as refused:
        router.plan_route("demo", ["dairy"], CATALOG)
    assert refused.value.problems == tuple(problems)


def test_the_same_list_gets_the_same_route(router: GridRouter) -> None:
    wanted = ["coffee", "dairy", "produce", "bakery"]
    assert router.plan_route("demo", wanted, CATALOG) == router.plan_route(
        "demo", list(reversed(wanted)), CATALOG
    )


def test_a_big_store_with_many_stops_routes_quickly() -> None:
    """The editor's largest grid, twenty departments, every one on the list."""
    rows = ["E" + "." * 59]
    letters = "abcdefghijklmnopqrst"
    for band in range(10):
        rows.append("." * 60)
        line = ["."] * 60
        for slot in range(2):
            letter = letters[band * 2 + slot]
            start = 4 + slot * 28
            for col in range(start, start + 20):
                line[col] = letter
        rows.append("".join(line))
        rows.append("." * 60)
    rows += ["." * 60] * (59 - len(rows)) + ["." * 58 + "CC"]
    labels = {letter: f"מחלקה {letter}" for letter in letters}
    catalog = {f"id-{letter}": category(f"id-{letter}", f"מחלקה {letter}") for letter in letters}
    router = GridRouter(plan_from(rows, labels))

    started = time.perf_counter()
    route = router.plan_route("demo", list(catalog), catalog)
    took = time.perf_counter() - started

    assert len(route.stops) == 20
    assert_walkable_and_connected(route, router)
    assert took < 3, f"{took:.2f} s"


def test_a_leg_is_drawn_with_a_star(router: GridRouter) -> None:
    route = router.plan_route("demo", ["coffee"], CATALOG)
    leg = route.legs[0]
    cells = tuple((point.row, point.col) for point in leg.cells)
    assert cells == find_path(FloorGrid(router.plan), cells[0], cells[-1])
    assert leg.length_m == pytest.approx(path_length(cells), abs=0.01)
