"""The flagship demo store: its floor plan, its catalog's routes, and the script that seeds it."""

import random
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import seed_demo_data
import seed_flagship_store as flagship
from app.config import Settings
from app.domain.floor_plan import FloorPlan
from app.domain.floor_routing import CELL_PREFIX, GridRouter
from app.domain.inventory import CatalogRow
from app.domain.models import Store
from app.main import create_app
from app.repositories.database import create_database_engine
from app.repositories.event_store import DEMO_SESSION_PREFIX
from app.repositories.floor_plan_repository import SqlFloorPlanRepository
from app.services.flagship_plan import COLS, ROWS, build_flagship_plan
from app.services.pos_import import read_pos_export

NOW = datetime(2026, 11, 12, 15, 30, tzinfo=UTC)
CATALOG = read_pos_export(seed_demo_data.POS_EXPORT)
SUBCATEGORIES = flagship.catalog_subcategories(CATALOG)


@pytest.fixture(scope="module")
def plan() -> FloorPlan:
    return build_flagship_plan(SUBCATEGORIES)


@pytest.fixture(scope="module")
def router(plan: FloorPlan) -> GridRouter:
    return GridRouter(plan)


def tiles_by_label(plan: FloorPlan) -> dict[str, set[tuple[int, int]]]:
    found: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for entry in plan.labels:
        found[entry.label].add((entry.row, entry.col))
    return found


def connected(cells: set[tuple[int, int]]) -> bool:
    start = next(iter(cells))
    seen, queue = {start}, [start]
    while queue:
        row, col = queue.pop()
        for step in ((row + 1, col), (row - 1, col), (row, col + 1), (row, col - 1)):
            if step in cells and step not in seen:
                seen.add(step)
                queue.append(step)
    return seen == cells


# ---------- The plan ----------


def test_it_is_a_large_store_of_metre_tiles(plan: FloorPlan) -> None:
    assert (plan.rows, plan.cols, plan.cell_size_m) == (40, 60, 1.0)


def test_walls_close_it_in_but_for_the_door_in_the_front(plan: FloorPlan) -> None:
    edge = [
        (row, col) for row in range(ROWS) for col in range(COLS) if row in (0, ROWS - 1) or col in (0, COLS - 1)
    ]
    kinds = {plan.tiles[row][col] for row, col in edge}
    assert kinds == {"wall", "entrance"}
    assert {row for row, col in edge if plan.tiles[row][col] == "entrance"} == {ROWS - 1}


def test_a_row_of_tills_along_the_front(plan: FloorPlan) -> None:
    tills = [(row, col) for row, line in enumerate(plan.tiles) for col, kind in enumerate(line) if kind == "checkout"]
    assert len(tills) == 12
    assert len({row for row, _ in tills}) == 1
    assert min(row for row, _ in tills) > ROWS * 3 // 4


def test_it_routes(router: GridRouter) -> None:
    assert router.routable


def test_every_shelf_is_a_subcategory_of_the_catalog_and_every_subcategory_a_shelf(plan: FloorPlan) -> None:
    shelves = {(row, col) for row, line in enumerate(plan.tiles) for col, kind in enumerate(line) if kind == "shelf"}
    labelled = {(entry.row, entry.col) for entry in plan.labels}
    assert shelves == labelled
    drawn = set(tiles_by_label(plan))
    in_catalog = {name for names in SUBCATEGORIES.values() for name in names}
    assert drawn == in_catalog
    assert len(drawn) == 30


def test_each_subcategory_is_one_shelf_in_one_piece(plan: FloorPlan, router: GridRouter) -> None:
    for label, cells in tiles_by_label(plan).items():
        assert connected(cells), label
        assert router.stop_for(label) is not None, label


def test_a_departments_subcategories_stand_together(plan: FloorPlan) -> None:
    # The box round a department's shelves holds none of another department's.
    tiles = tiles_by_label(plan)
    department_of = {name: department for department, names in SUBCATEGORIES.items() for name in names}
    for department, names in SUBCATEGORIES.items():
        mine = set().union(*(tiles[name] for name in names))
        rows = [row for row, _ in mine]
        cols = [col for _, col in mine]
        others = {
            label
            for label, cells in tiles.items()
            if department_of[label] != department
            and any(min(rows) <= row <= max(rows) and min(cols) <= col <= max(cols) for row, col in cells)
        }
        assert others == set(), department


def test_fresh_food_is_by_the_door_and_dairy_at_the_back(router: GridRouter) -> None:
    door = (ROWS - 1, 4)
    vegetables = router.stop_for("ירקות")
    milk = router.stop_for("חלב וביצים")
    assert vegetables is not None and milk is not None
    assert router.flood(door)[vegetables] < router.flood(door)[milk] / 2


def test_a_catalog_department_with_no_place_is_refused() -> None:
    with pytest.raises(ValueError, match="pets"):
        build_flagship_plan({**SUBCATEGORIES, "pets": ["מזון לכלבים"]})


def test_a_department_with_more_subcategories_splits_its_shelves(router: GridRouter) -> None:
    more = {**SUBCATEGORIES, "snacks": ["חטיפים מלוחים", "שוקולד וממתקים", "מסטיקים", "פיצוחים"]}
    labels = {entry.label for entry in build_flagship_plan(more).labels}
    assert {"מסטיקים", "פיצוחים"} <= labels


# ---------- Every product reaches its own shelf ----------


def test_every_product_and_department_reaches_a_shelf_of_its_own(router: GridRouter, store: Store) -> None:
    assert flagship.verify_routing(router, store, CATALOG) == len(CATALOG) + len(SUBCATEGORIES)


def test_a_product_whose_subcategory_has_no_shelf_stops_the_seed(router: GridRouter, store: Store) -> None:
    stray = CatalogRow(
        barcode="7290099999997",
        department="snacks",
        subcategory="מסטיקים",
        brand="מנטוס",
        item="מסטיק",
        size="30 גרם",
        zone="a4-s1-l",
    )
    with pytest.raises(flagship.FlagshipError, match="מסטיק"):
        flagship.verify_routing(router, store, [*CATALOG, stray])


# ---------- The activity on it ----------


def test_reports_stand_at_their_items_own_shelf(plan: FloorPlan, router: GridRouter) -> None:
    subcategory_of = {row.display_name: row.subcategory for row in CATALOG}
    hours = seed_demo_data._open_hours(NOW)
    events = flagship.plan_reports(
        router, plan, "demo", subcategory_of, seed_demo_data.PROBLEM_REPORTS, hours, NOW, random.Random(3), ""
    )
    assert len(events) == sum(count for _, _, count in seed_demo_data.PROBLEM_REPORTS)
    for event in events:
        row, col = router.stop_for(subcategory_of[event.item_query])
        assert abs(event.x_coord - (col + 0.5)) <= flagship.REPORT_SPREAD_M
        assert abs(event.y_coord - (ROWS - row - 0.5)) <= flagship.REPORT_SPREAD_M
        assert event.session_id.startswith(DEMO_SESSION_PREFIX)


def test_trips_walk_the_plan_step_by_step(router: GridRouter, store: Store) -> None:
    trips = flagship.plan_trips(router, store, CATALOG, NOW, random.Random(5))
    assert len(trips) > 500
    assert all(trip.timestamp < NOW for trip in trips)
    for trip in trips[:50]:
        for a, b in trip.edges:
            (row_a, col_a), (row_b, col_b) = (tuple(map(int, node.removeprefix(CELL_PREFIX).split(":"))) for node in (a, b))
            assert max(abs(row_a - row_b), abs(col_a - col_b)) == 1


def test_trips_reach_every_subcategorys_aisle(router: GridRouter, store: Store, plan: FloorPlan) -> None:
    trips = flagship.plan_trips(router, store, CATALOG, NOW, random.Random(5))
    walked = {node for trip in trips for edge in trip.edges for node in edge}
    # From whichever side of the shelf the route chose: a table can be reached from either.
    for label, cells in tiles_by_label(plan).items():
        beside = {
            f"{CELL_PREFIX}{row + d_row}:{col + d_col}"
            for row, col in cells
            for d_row, d_col in ((1, 0), (-1, 0), (0, 1), (0, -1))
        }
        assert beside & walked, label


# ---------- The script ----------


@pytest.fixture()
def seeded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh database the script seeds, with its backups kept apart."""
    path = tmp_path / "flagship.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")
    monkeypatch.setattr(flagship, "BACKUP_DIR", tmp_path / "backups")
    assert flagship.main([]) == 0
    return path


def saved_plan() -> FloorPlan | None:
    engine = create_database_engine(Settings.from_env().database_url)
    try:
        stored = SqlFloorPlanRepository(engine).load("demo")
        return stored.plan if stored else None
    finally:
        engine.dispose()


def test_the_script_saves_the_flagship_plan(seeded: Path, plan: FloorPlan) -> None:
    assert saved_plan() == plan


def test_shoppers_and_managers_get_it_from_the_api(seeded: Path) -> None:
    with TestClient(create_app(Settings.from_env())) as client:
        answer = client.get("/api/v1/stores/demo/floor-plan").json()
        assert answer["check"]["routable"]
        product_stops = client.get("/api/v1/stores/demo/map").json()["product_stops"]
        # Every catalog product is placed, and on the shelf of its own subcategory.
        assert len(product_stops) >= len(CATALOG)
        subcategory_of = {stop["id"]: stop["subcategory"] for stop in product_stops}
        for product_id, place in answer["placements"].items():
            if product_id in subcategory_of and subcategory_of[product_id]:
                assert place == subcategory_of[product_id], product_id
        # A shopper's report from the far side of the 60 m store is kept.
        report = {
            "event_id": "8d6b7b1e-6c39-4a8e-9f0e-2a9a1f3c4d55",
            "store_id": "demo",
            "session_id": "a-real-shopper",
            "item_query": "גלידה",
            "category_id": "frozen",
            "x_coord": 55.0,
            "y_coord": 6.0,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        assert client.post("/api/events/not-found", json=report).status_code == 201


def test_a_second_run_backs_up_the_plan_it_replaces_and_restoring_puts_it_back(seeded: Path, tmp_path: Path) -> None:
    assert flagship.main([]) == 0
    (backup,) = (tmp_path / "backups").glob("floor-plan-demo-*.json")
    hand_drawn = FloorPlan.model_validate_json(backup.read_text(encoding="utf-8"))
    assert hand_drawn == saved_plan()
    assert flagship.main(["--restore-plan", str(backup)]) == 0
    assert saved_plan() == hand_drawn


def test_clearing_takes_out_the_activity_and_catalog_but_keeps_the_plan(seeded: Path, plan: FloorPlan) -> None:
    assert flagship.main(["--clear"]) == 0
    engine = create_database_engine(Settings.from_env().database_url)
    try:
        with engine.connect() as connection:
            for table in ("not_found_events", "search_misses", "trips"):
                assert connection.exec_driver_sql(f"SELECT COUNT(*) FROM {table}").scalar_one() == 0, table
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM products WHERE source = 'pos'").scalar_one() == 0
    finally:
        engine.dispose()
    assert saved_plan() == plan


def test_the_script_says_what_it_did(seeded: Path, capsys: pytest.CaptureFixture[str]) -> None:
    flagship.main([])
    out = capsys.readouterr().out
    assert "60 × 40 m plan with 30 subcategory shelves" in out
    assert f"{len(CATALOG)} products ({len(CATALOG) + len(SUBCATEGORIES)} routes checked" in out
    assert "--restore-plan" in out
