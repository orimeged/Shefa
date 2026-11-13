"""Turns the demo store into the flagship store: a 60 by 40 metre supermarket, for a demo to managers.

    python seed_flagship_store.py                      catalog, floor plan and two weeks of activity
    python seed_flagship_store.py --clear              take the demo activity and catalog out again
    python seed_flagship_store.py --restore-plan FILE  put back a floor plan saved before

Run it from backend/ with the virtual environment's Python. It writes to DATABASE_URL,
which it prints without the password, so check that's the database you mean.

What a run does, in this order:

1. Reads the 258-product catalog (app/data/demo_pos_export.csv) and draws the flagship
   floor plan from its subcategories (app/services/flagship_plan.py): every shelf is one
   subcategory, so every product has a shelf of exactly its kind.
2. Routes every product, and every department, on that plan, and stops with an error if
   any of them doesn't reach a shelf of its own. Nothing is written before this passes.
3. Imports the catalog through the same importer a chain's real export uses.
4. Saves the store's current floor plan to a file, if it has one, and prints where; then
   saves the flagship plan. Shoppers' apps and the dashboard pick it up on their next request.
5. Writes two weeks of made-up activity on the plan: "not found" reports beside their
   item's shelf, routes walked through it, searches that found nothing. All of it is
   marked as made up, replaced by the next run and removed by --clear; real shoppers'
   rows are never touched. Run it on the day of the demo: it ages out of the 7-day reports.
"""

import argparse
import random
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import seed_demo_data as demo
from app.config import Settings
from app.domain.analytics import RouteTrip
from app.domain.events import NotFoundEvent, NotFoundReport
from app.domain.floor_plan import FloorPlan
from app.domain.floor_routing import GridRouter, grid_route_edges
from app.domain.inventory import CatalogRow
from app.domain.models import Category, Store
from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.database import create_database_engine, migrate, printable_url
from app.repositories.pick_store import SqlPickSessions
from app.repositories.event_store import DEMO_SESSION_PREFIX, SqlEventStore
from app.repositories.floor_plan_repository import SqlFloorPlanRepository
from app.repositories.inventory_repository import SqlInventoryRepository
from app.repositories.store_repository import JsonStoreRepository
from app.services.flagship_plan import build_flagship_plan
from app.services.pos_import import read_pos_export

BACKUP_DIR = Path(__file__).parent / "var" / "floor-plan-backups"
# A report is made standing at the shelf: on the tile a shopper stands on for it, give or take.
REPORT_SPREAD_M = 0.45
SHELF_TARGET = "shelf:"


class FlagshipError(RuntimeError):
    """The plan doesn't carry the catalog: nothing has been written."""


def catalog_subcategories(catalog: Sequence[CatalogRow]) -> dict[str, list[str]]:
    """Each department's subcategories, in the order the catalog first lists them."""
    found: dict[str, dict[str, None]] = {}
    for row in catalog:
        found.setdefault(row.department, {})[row.subcategory] = None
    return {department: list(names) for department, names in found.items()}


def route_targets(layout: Store, catalog: Sequence[CatalogRow]) -> dict[str, Category]:
    """The departments, each product as a placed one would be, and each shelf by its name."""
    targets = {category.id: category for category in layout.categories}
    for row in catalog:
        targets[f"item:{row.barcode}"] = Category(
            id=f"item:{row.barcode}",
            name=row.display_name,
            name_en=row.display_name,
            section_id="unused",
            department_id=row.department,
            subcategory=row.subcategory,
        )
    for names in catalog_subcategories(catalog).values():
        for name in names:
            targets[f"{SHELF_TARGET}{name}"] = Category(id=f"{SHELF_TARGET}{name}", name=name, name_en=name, section_id="unused")
    return targets


def verify_routing(router: GridRouter, layout: Store, catalog: Sequence[CatalogRow]) -> int:
    """Every product reaches a shelf of its own subcategory, every department one of its own.

    Returns how many routes were checked; raises before anything is written otherwise.
    """
    if not router.routable:
        raise FlagshipError(f"the flagship plan doesn't route: {router.problems}")
    targets = route_targets(layout, catalog)
    subcategories = catalog_subcategories(catalog)
    checked = 0
    wrong: list[str] = []
    for row in catalog:
        route = router.plan_route(layout.id, [f"item:{row.barcode}"], targets, None, subcategories)
        reached = [stop.department for stop in route.stops]
        if reached != [row.subcategory]:
            wrong.append(f"{row.display_name}: {reached or 'not on the map'}, not {row.subcategory}")
        checked += 1
    for department, names in subcategories.items():
        route = router.plan_route(layout.id, [department], targets, None, subcategories)
        reached = [stop.department for stop in route.stops]
        if len(reached) != 1 or reached[0] not in names:
            wrong.append(f"department {department}: {reached or 'not on the map'}")
        checked += 1
    if wrong:
        raise FlagshipError("some products don't reach their shelf:\n  " + "\n  ".join(wrong[:20]))
    return checked


def plan_reports(
    router: GridRouter,
    plan: FloorPlan,
    store_id: str,
    subcategory_of: Mapping[str, str],
    tallies: Sequence[tuple[str, str, int]],
    hours: Sequence[datetime],
    now: datetime,
    rng: random.Random,
    tag: str,
) -> list[NotFoundEvent]:
    """Through the same checks as a real report, standing at the item's own shelf, in the plan's metres."""
    size = plan.cell_size_m
    events: list[NotFoundEvent] = []
    for category_id, item, count in tallies:
        stop = router.stop_for(subcategory_of[item])
        if stop is None:
            raise FlagshipError(f"no shelf on the plan for {item}")
        row, col = stop
        for _ in range(count):
            events.append(
                NotFoundEvent.from_report(
                    NotFoundReport(
                        store_id=store_id,
                        session_id=f"{DEMO_SESSION_PREFIX}flagship-{tag}{len(events)}",
                        item_query=item,
                        category_id=category_id,
                        x_coord=(col + 0.5) * size + rng.uniform(-REPORT_SPREAD_M, REPORT_SPREAD_M),
                        y_coord=(plan.rows - row - 0.5) * size + rng.uniform(-REPORT_SPREAD_M, REPORT_SPREAD_M),
                        timestamp=rng.choice(hours) + timedelta(seconds=rng.randrange(3600)),
                    ),
                    now,
                )
            )
    return events


def plan_report_maker(
    router: GridRouter,
    plan: FloorPlan,
    store_id: str,
    subcategory_of: Mapping[str, str],
    now: datetime,
    rng: random.Random,
) -> demo.MakeReport:
    """A report at the item's own shelf on the plan, for alerts the seed marks closed."""
    size = plan.cell_size_m

    def make(category_id: str, item: str, moment: datetime, tag: str) -> NotFoundEvent:
        stop = router.stop_for(subcategory_of[item])
        if stop is None:
            raise FlagshipError(f"no shelf on the plan for {item}")
        row, col = stop
        return NotFoundEvent.from_report(
            NotFoundReport(
                store_id=store_id,
                session_id=f"{DEMO_SESSION_PREFIX}flagship-closed-{tag}",
                item_query=item,
                category_id=category_id,
                x_coord=(col + 0.5) * size + rng.uniform(-REPORT_SPREAD_M, REPORT_SPREAD_M),
                y_coord=(plan.rows - row - 0.5) * size + rng.uniform(-REPORT_SPREAD_M, REPORT_SPREAD_M),
                timestamp=moment,
            ),
            now,
        )

    return make


def plan_trips(
    router: GridRouter,
    layout: Store,
    catalog: Sequence[CatalogRow],
    now: datetime,
    rng: random.Random,
) -> list[RouteTrip]:
    """Two weeks of shoppers walking the plan: real routes, so traffic falls where people would walk.

    Each trip picks departments as often as people buy from them, and in each a shelf,
    so every subcategory's aisle gets its share.
    """
    targets = route_targets(layout, catalog)
    subcategories = catalog_subcategories(catalog)
    departments = list(demo.DEPARTMENT_POPULARITY)
    weights = list(demo.DEPARTMENT_POPULARITY.values())
    midnight = now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)

    trips: list[RouteTrip] = []
    for days_back in range(14):
        day = midnight - timedelta(days=days_back)
        share = 1.0 if days_back < 7 else demo.PREVIOUS_WEEK_SHARE
        count = round(demo.TRIPS_BY_WEEKDAY[day.weekday()] * share)
        for index in range(count):
            # Spread evenly, so the morning of one week compares fairly with the last.
            into_day = (demo.CLOSING_HOUR - demo.OPENING_HOUR) * (index + rng.random()) / count
            moment = day + timedelta(hours=demo.OPENING_HOUR + into_day)
            if moment >= now:
                continue
            picks = rng.choices(departments, weights, k=rng.randint(demo.MIN_STOPS, demo.MAX_STOPS))
            shelves = [f"{SHELF_TARGET}{rng.choice(subcategories[department])}" for department in picks]
            route = router.plan_route(layout.id, shelves, targets, None, subcategories)
            trips.append(
                RouteTrip(
                    store_id=layout.id,
                    session_id=f"{DEMO_SESSION_PREFIX}flagship-trip-{days_back}-{index}",
                    edges=grid_route_edges(route),
                    timestamp=moment.astimezone(UTC),
                )
            )
    return trips


def back_up_plan(plans: SqlFloorPlanRepository, store_id: str, folder: Path) -> Path | None:
    """The store's current plan, to a file, before the flagship plan replaces it."""
    stored = plans.load(store_id)
    if stored is None:
        return None
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"floor-plan-{store_id}-{stored.saved_at.astimezone(UTC):%Y%m%d-%H%M%S}.json"
    path.write_text(stored.plan.model_dump_json(indent=2), encoding="utf-8")
    return path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed, clear or undo the flagship demo store.")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--clear", action="store_true", help="remove the demo activity and catalog")
    action.add_argument("--restore-plan", type=Path, metavar="FILE", help="put back a floor plan saved before")
    arguments = parser.parse_args(argv)

    settings = Settings.from_env()
    layout = next(store for store in JsonStoreRepository(settings.data_dir).list_stores() if store.id == demo.DEMO_STORE_ID)
    # Never the password: this lands in a terminal, or a host's build log.
    where = printable_url(settings.database_url)

    if arguments.restore_plan is None and not arguments.clear:
        # Everything checked before anything is written.
        catalog = read_pos_export(demo.POS_EXPORT)
        plan = build_flagship_plan(catalog_subcategories(catalog))
        router = GridRouter(plan)
        checked = verify_routing(router, layout, catalog)

    database = create_database_engine(settings.database_url)
    migrate(database)
    events = SqlEventStore(database)
    analytics = SqlAnalyticsStore(database)
    inventory = SqlInventoryRepository(database)
    plans = SqlFloorPlanRepository(database)
    inventory.sync_layout(layout)
    try:
        if arguments.restore_plan is not None:
            restored = FloorPlan.model_validate_json(arguments.restore_plan.read_text(encoding="utf-8"))
            plans.save(layout.id, restored, datetime.now(UTC))
            print(f"Put back the floor plan from {arguments.restore_plan} in {where}")
            return 0

        if arguments.clear:
            events.replace_demo_events([])
            analytics.replace_demo_data([], [])
            SqlPickSessions(database).replace_demo_sessions([])
            inventory.remove_imported_catalog(layout)
            print(f"Removed the demo activity and catalog from {where}. The floor plan stays; --restore-plan puts back an older one.")
            return 0

        placeholders = {product.barcode for product in layout.products}
        inventory.import_catalog(layout.id, catalog, retire_barcodes=placeholders)
        now = datetime.now(UTC)
        backup = back_up_plan(plans, layout.id, BACKUP_DIR)
        plans.save(layout.id, plan, now)

        rng = random.Random()
        subcategory_of = {row.display_name: row.subcategory for row in catalog}
        reports = plan_reports(
            router, plan, layout.id, subcategory_of,
            (*demo.PROBLEM_REPORTS, *demo.BACKGROUND_REPORTS), demo._open_hours(now), now, rng, "",
        )
        make = plan_report_maker(router, plan, layout.id, subcategory_of, now, rng)
        closed = [
            *demo.closed_reports(demo.CLOSED_THIS_WEEK, demo.closed_this_week_hours(now), rng, make, "week-"),
            *demo.closed_reports(demo.PREVIOUS_WEEK_REPORTS, demo.previous_week_hours(now), rng, make, "previous-"),
        ]
        misses = demo.build_misses(now, rng)
        trips = plan_trips(router, layout, catalog, now, rng)
        events.replace_demo_events(reports, closed)
        analytics.replace_demo_data(misses, trips)
        SqlPickSessions(database).replace_demo_sessions(demo.build_pick_sessions(layout.id, now, rng))
    finally:
        database.dispose()

    shelves = sorted({label.label for label in plan.labels})
    print(
        f"Flagship store in {where}: a {plan.cols} × {plan.rows} m plan with {len(shelves)} subcategory shelves, "
        f"{len(catalog)} products ({checked} routes checked, each to its own shelf), "
        f"{len(reports)} reports, {len(misses)} unfulfilled searches and {len(trips)} trips."
    )
    if backup is not None:
        print(f"The plan it replaced is in {backup}; --restore-plan {backup} puts it back.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except FlagshipError as error:
        print(f"Nothing was written: {error}", file=sys.stderr)
        sys.exit(1)
