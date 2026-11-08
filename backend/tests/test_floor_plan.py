"""The floor plan managers draw: what's accepted, and walking on it with A*."""

import math
import random

import pytest
from pydantic import ValidationError

from app.domain.floor_plan import FloorGrid, FloorPlan, distances_from, find_path, octile, path_length
from tests.floor_plans import plan_from, plan_payload

OPEN = [
    "E....",
    ".....",
    ".....",
    ".....",
    "....C",
]


def test_the_editors_payload_is_accepted_as_is() -> None:
    plan = plan_from(
        [
            "#####",
            "E.dd.",
            ".....",
            ".SS..",
            "...C.",
        ],
        {"d": "מוצרי חלב"},
    )

    assert (plan.rows, plan.cols, plan.cell_size_m) == (5, 5, 1.0)
    assert plan.tiles[1][2] == "shelf"
    assert [(entry.row, entry.col, entry.label) for entry in plan.labels] == [
        (1, 2, "מוצרי חלב"),
        (1, 3, "מוצרי חלב"),
    ]
    assert plan.cells_of("entrance") == [(1, 0)]


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"version": 2}, "version"),
        ({"rows": 4}, "rows"),
        ({"rows": 61}, "rows"),
        ({"extra": True}, "extra"),
        ({"cell_size_m": 0}, "cell_size_m"),
    ],
)
def test_a_payload_of_the_wrong_kind_is_refused(change: dict[str, object], reason: str) -> None:
    with pytest.raises(ValidationError, match=reason):
        FloorPlan.model_validate({**plan_payload(OPEN), **change})


def test_the_grid_must_match_its_stated_size() -> None:
    payload = plan_payload(OPEN)
    payload["tiles"] = payload["tiles"][:4]
    with pytest.raises(ValidationError, match="5 rows of 5"):
        FloorPlan.model_validate(payload)

    payload = plan_payload(OPEN)
    payload["tiles"][2] = payload["tiles"][2][:4]
    with pytest.raises(ValidationError, match="5 rows of 5"):
        FloorPlan.model_validate(payload)


def test_an_unknown_tile_is_refused() -> None:
    payload = plan_payload(OPEN)
    payload["tiles"][0][0] = "lava"
    with pytest.raises(ValidationError):
        FloorPlan.model_validate(payload)


@pytest.mark.parametrize(
    ("label", "reason"),
    [
        ({"row": 0, "col": 1, "label": "קפה"}, "isn't a shelf"),
        ({"row": 9, "col": 1, "label": "קפה"}, "outside the grid"),
        ({"row": 1, "col": 1, "label": "   "}, "blank"),
        ({"row": 1, "col": 1, "label": "x" * 41}, "label"),
    ],
)
def test_a_label_must_sit_on_a_shelf_and_say_something(
    label: dict[str, object], reason: str
) -> None:
    payload = plan_payload(["E....", ".S...", ".....", ".....", "....C"])
    payload["labels"] = [label]
    with pytest.raises(ValidationError, match=reason):
        FloorPlan.model_validate(payload)


def test_one_tile_can_hold_one_label() -> None:
    payload = plan_payload(["E....", ".S...", ".....", ".....", "....C"])
    payload["labels"] = [{"row": 1, "col": 1, "label": "קפה"}, {"row": 1, "col": 1, "label": "תה"}]
    with pytest.raises(ValidationError, match="two labels"):
        FloorPlan.model_validate(payload)


def test_a_labels_spacing_is_cleaned() -> None:
    payload = plan_payload(["E....", ".S...", ".....", ".....", "....C"])
    payload["labels"] = [{"row": 1, "col": 1, "label": "  מוצרי   חלב "}]
    assert FloorPlan.model_validate(payload).labels[0].label == "מוצרי חלב"


# ---------- Walking ----------


def test_a_straight_aisle_is_walked_straight() -> None:
    grid = FloorGrid(plan_from(OPEN))
    path = find_path(grid, (0, 0), (0, 4))

    assert path == ((0, 0), (0, 1), (0, 2), (0, 3), (0, 4))
    assert path_length(path) == 4


def test_open_floor_is_crossed_on_the_diagonal() -> None:
    path = find_path(FloorGrid(plan_from(OPEN)), (0, 0), (3, 3))
    assert path is not None
    assert path_length(path) == pytest.approx(3 * math.sqrt(2))


def test_a_shelf_is_walked_around() -> None:
    grid = FloorGrid(
        plan_from(
            [
                "E....",
                "SSSS.",
                ".....",
                ".....",
                "....C",
            ]
        )
    )
    path = find_path(grid, (0, 0), (2, 0))

    assert path is not None
    assert all(grid.is_walkable(cell) for cell in path)
    # Along the top, down the open end and back. No diagonals: each would cut a shelf corner.
    assert path_length(path) == 10


def test_a_route_never_squeezes_between_two_shelf_corners() -> None:
    grid = FloorGrid(
        plan_from(
            [
                "E#...",
                "#....",
                ".....",
                ".....",
                "....C",
            ]
        )
    )
    # (0,0) touches (1,1) only across the two wall corners.
    assert find_path(grid, (0, 0), (1, 1)) is None
    assert list(grid.neighbours((0, 0))) == []


def test_a_walled_off_tile_has_no_path() -> None:
    grid = FloorGrid(
        plan_from(
            [
                "E.#..",
                "..#..",
                "###..",
                ".....",
                "....C",
            ]
        )
    )
    assert find_path(grid, (0, 0), (4, 0)) is None
    assert (4, 0) not in distances_from(grid, [(0, 0)])


def test_a_path_to_where_you_stand_is_that_tile() -> None:
    assert find_path(FloorGrid(plan_from(OPEN)), (2, 2), (2, 2)) == ((2, 2),)


def test_nothing_starts_or_ends_inside_a_shelf() -> None:
    grid = FloorGrid(plan_from(["E....", ".S...", ".....", ".....", "....C"]))
    assert find_path(grid, (1, 1), (0, 0)) is None
    assert find_path(grid, (0, 0), (4, 4)) is None  # the checkout counter itself
    assert find_path(grid, (0, 0), (9, 9)) is None


def _random_grid(seed: int) -> FloorGrid:
    chance = random.Random(seed)
    size = chance.randint(5, 25)
    rows = [
        "".join("S" if chance.random() < 0.3 else "." for _ in range(size)) for _ in range(size)
    ]
    rows[0] = "E" + rows[0][1:]
    return FloorGrid(plan_from(rows))


@pytest.mark.parametrize("seed", range(30))
def test_a_star_finds_the_shortest_walk_dijkstra_finds(seed: int) -> None:
    grid = _random_grid(seed)
    chance = random.Random(seed + 1000)
    distances = distances_from(grid, [(0, 0)])
    for goal in chance.sample(sorted(distances), min(10, len(distances))):
        path = find_path(grid, (0, 0), goal)
        assert path is not None
        assert path_length(path) == pytest.approx(distances[goal])
        assert all(grid.is_walkable(cell) for cell in path)
        for a, b in zip(path, path[1:], strict=False):
            assert max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1
        # The estimate never overshoots, which is what makes A* exact.
        assert octile((0, 0), goal) <= distances[goal] + 1e-9


def test_the_same_request_draws_the_same_line() -> None:
    grid = _random_grid(7)
    goal = max(distances_from(grid, [(0, 0)]))
    assert find_path(grid, (0, 0), goal) == find_path(grid, (0, 0), goal)
