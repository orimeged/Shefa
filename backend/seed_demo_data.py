"""Fills the demo store with a realistic catalog and made-up activity, for a live demo.

    python seed_demo_data.py            replace the last demo data with fresh data
    python seed_demo_data.py --clear    take the demo data out again

Run it from backend/ with the virtual environment's Python. The catalog comes from
app/data/demo_pos_export.csv, through the same importer a chain's real export would
use. The script only writes to the demo store, leaves real shoppers' rows and products
a manager added alone, and each run replaces the one before, so it's safe to run
right before a meeting. It's also the way to reopen alerts closed in a rehearsal.
"Today" is built from the hours gone so far, so run it on the day: a seed ages out
of the 7-day reports within days.
"""

import argparse
import random
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path
from uuid import uuid4

from app.config import Settings
from app.domain.analytics import RouteTrip, SearchMiss, route_edges
from app.domain.events import NotFoundEvent, NotFoundReport, Resolution
from app.domain.picking import PickSession
from app.domain.models import Store
from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.database import create_database_engine, migrate, printable_url
from app.repositories.event_store import DEMO_SESSION_PREFIX, SqlEventStore
from app.repositories.inventory_repository import SqlInventoryRepository
from app.repositories.pick_store import SqlPickSessions
from app.repositories.store_repository import JsonStoreRepository
from app.services.navigation import NavigationService
from app.services.pos_import import read_pos_export

DEMO_STORE_ID = "demo"
POS_EXPORT = Path(__file__).parent / "app" / "data" / "demo_pos_export.csv"

WEEK_HOURS = 7 * 24
WINDOW_HOURS = 72
OPENING_HOUR = 7
CLOSING_HOUR = 22
# A report lands near the shelf, not on the spot routing walks to.
AISLE_SPREAD_M = (0.6, 1.6)

# The problem area for the manager to spot: 35 of the 50 reports, on three departments.
PROBLEM_REPORTS: tuple[tuple[str, str, int], ...] = (
    ("bakery", "לחם אחיד פרוס אנג'ל 750 גרם", 7),
    ("bakery", "פיתות כפריות אנג'ל 10 יחידות", 5),
    ("bakery", "לחמניות מתוקות ברמן 6 יחידות", 3),
    ("dairy", "חלב 3% תנובה 1 ליטר", 6),
    ("dairy", "קוטג' 5% תנובה 250 גרם", 4),
    ("dairy", "גבינה לבנה 5% תנובה 250 גרם", 2),
    ("produce", "עגבניות שרי מהדרין 500 גרם", 5),
    ("produce", "מלפפונים מהדרין 1 קילו", 3),
)

# Everyday noise: spread thin, so none of it reaches the alert threshold.
BACKGROUND_REPORTS: tuple[tuple[str, str, int], ...] = (
    ("sauces", "טחינה גולמית הנסיך 500 גרם", 2),
    ("coffee", "קפה טורקי עלית 250 גרם", 2),
    ("pasta", "אורז בסמטי סוגת 1 קילו", 2),
    ("baby", "חיתולים מידה 4 האגיס 56 יחידות", 2),
    ("snacks", "במבה אסם 80 גרם", 1),
    ("beverages", "סודה שוופס 1.5 ליטר", 1),
    ("beverages", "מיץ תפוזים טבעי פריגת 1 ליטר", 1),
    ("frozen", "גלידת וניל שטראוס 1 ליטר", 1),
    ("toiletries", "משחת שיניים קולגייט 100 מ\"ל", 1),
    ("cleaning", "אקונומיקה סנו 2 ליטר", 1),
    ("meat", "חזה עוף טרי עוף טוב 1 קילו", 1),
)


# Last week was quieter, so every figure on the dashboard has somewhere to have moved from.
PREVIOUS_WEEK_SHARE = 0.8

# An alert a manager already closed: department, item, reports, what they found, and
# minutes from the first report to closing it.
ClosedSpec = tuple[str, str, int, Resolution, int]

# Alerts dealt with earlier this week: mostly refilled within the hour, and three items
# that were on the floor all along, so the "misplaced" figure isn't empty.
CLOSED_THIS_WEEK: tuple[ClosedSpec, ...] = (
    ("dairy", "יוגורט יווני דנונה 200 גרם", 3, "restocked", 35),
    ("dairy", "ביצים L משק 12 יחידות", 3, "restocked", 30),
    ("bakery", "חלה מתוקה ברמן 450 גרם", 2, "restocked", 55),
    ("beverages", "קוקה קולה קוקה קולה 1.5 ליטר", 3, "restocked", 40),
    ("meat", "בשר טחון טרי טיבון 500 גרם", 2, "restocked", 75),
    ("sauces", "חומוס מוכן צבר 400 גרם", 2, "on_shelf", 25),
    ("sauces", 'שמן זית כתית מעולה יד מרדכי 750 מ"ל', 1, "on_shelf", 20),
    ("cleaning", "טבליות למדיח פיירי 40 יחידות", 2, "relocated", 90),
)

# The week before: about as many reports, a little more money, and refilling took
# hours. So the figures move the way a store using the alerts would see them move.
PREVIOUS_WEEK_REPORTS: tuple[ClosedSpec, ...] = (
    ("bakery", "לחם אחיד פרוס אנג'ל 750 גרם", 8, "restocked", 150),
    ("bakery", "פיתות כפריות אנג'ל 10 יחידות", 6, "restocked", 170),
    ("bakery", "חלה מתוקה ברמן 450 גרם", 3, "restocked", 95),
    ("dairy", "חלב 3% תנובה 1 ליטר", 7, "restocked", 120),
    ("dairy", "קוטג' 5% תנובה 250 גרם", 5, "restocked", 140),
    ("dairy", "ביצים L משק 12 יחידות", 4, "restocked", 210),
    ("dairy", "יוגורט יווני דנונה 200 גרם", 3, "restocked", 90),
    ("produce", "עגבניות שרי מהדרין 500 גרם", 6, "restocked", 180),
    ("produce", "מלפפונים מהדרין 1 קילו", 4, "restocked", 160),
    ("baby", "חיתולים מידה 4 האגיס 56 יחידות", 3, "restocked", 240),
    ("meat", "חזה עוף טרי עוף טוב 1 קילו", 2, "restocked", 130),
    ("meat", "בשר טחון טרי טיבון 500 גרם", 2, "restocked", 200),
    ("coffee", "קפה טורקי עלית 250 גרם", 3, "restocked", 110),
    ("pasta", "אורז בסמטי סוגת 1 קילו", 2, "restocked", 150),
    ("beverages", "קוקה קולה קוקה קולה 1.5 ליטר", 3, "restocked", 100),
    ("sauces", "טחינה גולמית הנסיך 500 גרם", 2, "on_shelf", 60),
    ("sauces", 'שמן זית כתית מעולה יד מרדכי 750 מ"ל', 2, "on_shelf", 45),
    ("cleaning", "טבליות למדיח פיירי 40 יחידות", 2, "relocated", 120),
)

# Online orders picked this week with the sorted list. This week only: how much faster
# than before is what a pilot measures, so the demo doesn't make one up.
PICK_ORDERS = 18
PICK_LINES = (12, 34)
PICK_SECONDS_PER_LINE = (55, 95)
PICK_MISSING_SHARE = 0.03

# One demo report, for an item at a moment, wherever the store keeps it.
MakeReport = Callable[[str, str, datetime, str], NotFoundEvent]

# What shoppers asked for and the catalog doesn't list, this week. The department is
# None for what doesn't belong to any of them.
SEARCH_MISSES: tuple[tuple[str | None, str, int], ...] = (
    ("dairy", "חלב שקדים", 14),
    ("dairy", "חלב שיבולת שועל", 9),
    ("dairy", "יוגורט טבעוני", 6),
    ("bakery", "לחם ללא גלוטן", 11),
    ("bakery", "לחם כוסמין", 7),
    ("cereals", "שיבולת שועל ללא גלוטן", 10),
    ("cereals", "גרנולה דלת סוכר", 5),
    ("snacks", "חטיף חלבון", 8),
    ("snacks", "שוקולד ללא סוכר", 4),
    ("beverages", "קומבוצ'ה", 6),
    ("frozen", "פיצה טבעונית", 4),
    (None, "נרות שבת", 3),
)

# Israeli shopping weeks peak before the weekend. Monday is 0.
TRIPS_BY_WEEKDAY = {6: 75, 0: 80, 1: 85, 2: 100, 3: 140, 4: 120, 5: 35}

# How often a trip includes each department, so some aisles carry far more people.
DEPARTMENT_POPULARITY = {
    "dairy": 10,
    "produce": 10,
    "bakery": 9,
    "meat": 6,
    "beverages": 6,
    "snacks": 5,
    "frozen": 5,
    "cleaning": 3,
    "coffee": 3,
    "pasta": 3,
    "sauces": 3,
    "cereals": 2,
    "canned": 2,
    "toiletries": 2,
    "baby": 1,
}
MIN_STOPS = 3
MAX_STOPS = 8


def _open_hours(now: datetime, oldest: int = WINDOW_HOURS, newest: int = 1) -> list[datetime]:
    """Each hour between `newest` and `oldest` hours back with the store open, by this computer's clock.

    Nobody reports an empty shelf at 3 a.m., and a manager would notice. Each hour
    ends by `now`, so no report lands in the future.
    """
    this_hour = now.astimezone().replace(minute=0, second=0, microsecond=0)
    hours = (this_hour - timedelta(hours=back) for back in range(newest, oldest))
    return [hour for hour in hours if OPENING_HOUR <= hour.hour < CLOSING_HOUR]


@cache
def _zone_of_item() -> dict[str, str]:
    return {row.display_name: row.zone for row in read_pos_export(POS_EXPORT)}


def _reports(
    layout: Store,
    tallies: Sequence[tuple[str, str, int]],
    hours: Sequence[datetime],
    now: datetime,
    rng: random.Random,
    tag: str,
) -> list[NotFoundEvent]:
    """Goes through the same checks as a real report, beside the item's real shelf."""
    nodes = {node.id: node for node in layout.nodes}
    sections = {section.id: section for section in layout.sections}
    zones = _zone_of_item()
    shelves = {item: nodes[sections[zones[item]].node_id] for _, item, _ in tallies}
    spread_x, spread_y = AISLE_SPREAD_M
    return [
        NotFoundEvent.from_report(
            NotFoundReport(
                store_id=layout.id,
                session_id=f"{DEMO_SESSION_PREFIX}{tag}{index}",
                item_query=item,
                category_id=category_id,
                x_coord=shelves[item].x + rng.uniform(-spread_x, spread_x),
                y_coord=shelves[item].y + rng.uniform(-spread_y, spread_y),
                timestamp=rng.choice(hours) + timedelta(seconds=rng.randrange(3600)),
            ),
            now,
        )
        for index, (category_id, item) in enumerate(
            (category_id, item)
            for category_id, item, count in tallies
            for _ in range(count)
        )
    ]


def closed_reports(
    specs: Sequence[ClosedSpec],
    hours: Sequence[datetime],
    rng: random.Random,
    make: MakeReport,
    tag: str,
) -> list[tuple[NotFoundEvent, datetime, Resolution]]:
    """Each spec's reports, all before the manager closed them `minutes` after the first."""
    closed: list[tuple[NotFoundEvent, datetime, Resolution]] = []
    for spec_index, (category_id, item, count, resolution, minutes) in enumerate(specs):
        first = rng.choice(hours) + timedelta(seconds=rng.randrange(3600))
        resolved_at = first + timedelta(minutes=minutes)
        for index in range(count):
            # The first report opens the alert; the rest come in before it's dealt with.
            moment = first if index == 0 else first + timedelta(minutes=rng.uniform(0, minutes * 0.8))
            event = make(category_id, item, moment, f"{tag}{spec_index}-{index}")
            closed.append((event, resolved_at, resolution))
    return closed


def closed_this_week_hours(now: datetime) -> list[datetime]:
    """A day or more ago, so none of them still shows on the alerts table."""
    return _open_hours(now, oldest=WEEK_HOURS - 24, newest=24)


def previous_week_hours(now: datetime) -> list[datetime]:
    """Older than the alerts table looks, so they only move the trend."""
    return _open_hours(now, oldest=2 * WEEK_HOURS - 24, newest=WEEK_HOURS + 24)


def _graph_report_maker(layout: Store, now: datetime, rng: random.Random) -> MakeReport:
    nodes = {node.id: node for node in layout.nodes}
    sections = {section.id: section for section in layout.sections}
    zones = _zone_of_item()
    spread_x, spread_y = AISLE_SPREAD_M

    def make(category_id: str, item: str, moment: datetime, tag: str) -> NotFoundEvent:
        shelf = nodes[sections[zones[item]].node_id]
        return NotFoundEvent.from_report(
            NotFoundReport(
                store_id=layout.id,
                session_id=f"{DEMO_SESSION_PREFIX}closed-{tag}",
                item_query=item,
                category_id=category_id,
                x_coord=shelf.x + rng.uniform(-spread_x, spread_x),
                y_coord=shelf.y + rng.uniform(-spread_y, spread_y),
                timestamp=moment,
            ),
            now,
        )

    return make


def build_closed_events(
    layout: Store, now: datetime, rng: random.Random
) -> list[tuple[NotFoundEvent, datetime, Resolution]]:
    make = _graph_report_maker(layout, now, rng)
    return [
        *closed_reports(CLOSED_THIS_WEEK, closed_this_week_hours(now), rng, make, "week-"),
        *closed_reports(PREVIOUS_WEEK_REPORTS, previous_week_hours(now), rng, make, "previous-"),
    ]


def build_events(layout: Store, now: datetime, rng: random.Random) -> list[NotFoundEvent]:
    tallies = (*PROBLEM_REPORTS, *BACKGROUND_REPORTS)
    return _reports(layout, tallies, _open_hours(now), now, rng, "")


def build_pick_sessions(store_id: str, now: datetime, rng: random.Random) -> list[PickSession]:
    hours = _open_hours(now, oldest=WEEK_HOURS - 6, newest=2)
    sessions = []
    for _ in range(PICK_ORDERS):
        lines = rng.randint(*PICK_LINES)
        finished = rng.choice(hours) + timedelta(seconds=rng.randrange(3600))
        seconds = sum(rng.uniform(*PICK_SECONDS_PER_LINE) for _ in range(lines))
        sessions.append(
            PickSession(
                id=uuid4(),
                store_id=store_id,
                started_at=(finished - timedelta(seconds=seconds)).astimezone(UTC),
                finished_at=finished.astimezone(UTC),
                lines=lines,
                missing=sum(rng.random() < PICK_MISSING_SHARE for _ in range(lines)),
            )
        )
    return sessions


def build_misses(now: datetime, rng: random.Random) -> list[SearchMiss]:
    this_week = _open_hours(now, oldest=WEEK_HOURS)
    last_week = _open_hours(now, oldest=2 * WEEK_HOURS, newest=WEEK_HOURS)
    periods = ((this_week, 1.0), (last_week, PREVIOUS_WEEK_SHARE))
    return [
        SearchMiss(
            store_id=DEMO_STORE_ID,
            session_id=f"{DEMO_SESSION_PREFIX}miss-{period}-{item}-{index}",
            query=item,
            category_id=category_id,
            timestamp=rng.choice(hours) + timedelta(seconds=rng.randrange(3600)),
        )
        for period, (hours, share) in enumerate(periods)
        for category_id, item, count in SEARCH_MISSES
        for index in range(round(count * share))
    ]


def build_trips(layout: Store, now: datetime, rng: random.Random) -> list[RouteTrip]:
    """Real routes through the real floor plan, so traffic falls where people would walk."""
    navigation = NavigationService(layout)
    departments = list(DEPARTMENT_POPULARITY)
    weights = list(DEPARTMENT_POPULARITY.values())
    midnight = now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)

    trips: list[RouteTrip] = []
    for days_back in range(14):
        day = midnight - timedelta(days=days_back)
        share = 1.0 if days_back < 7 else PREVIOUS_WEEK_SHARE
        count = round(TRIPS_BY_WEEKDAY[day.weekday()] * share)
        for index in range(count):
            # Spread evenly, so the morning of one week compares fairly with the last.
            into_day = (CLOSING_HOUR - OPENING_HOUR) * (index + rng.random()) / count
            moment = day + timedelta(hours=OPENING_HOUR + into_day)
            if moment >= now:
                continue
            picks = rng.choices(departments, weights, k=rng.randint(MIN_STOPS, MAX_STOPS))
            trips.append(
                RouteTrip(
                    store_id=layout.id,
                    session_id=f"{DEMO_SESSION_PREFIX}trip-{days_back}-{index}",
                    edges=route_edges(navigation.plan_route(picks)),
                    timestamp=moment.astimezone(UTC),
                )
            )
    return trips


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed or clear the demo's dashboard data.")
    parser.add_argument("--clear", action="store_true", help="remove the demo data")
    arguments = parser.parse_args(argv)

    settings = Settings.from_env()
    layouts = JsonStoreRepository(settings.data_dir).list_stores()
    layout = next(layout for layout in layouts if layout.id == DEMO_STORE_ID)

    database = create_database_engine(settings.database_url)
    migrate(database)
    events = SqlEventStore(database)
    analytics = SqlAnalyticsStore(database)
    inventory = SqlInventoryRepository(database)
    inventory.sync_layout(layout)
    # Never the password: this lands in a terminal, or a host's build log.
    where = printable_url(settings.database_url)

    if arguments.clear:
        events.replace_demo_events([])
        analytics.replace_demo_data([], [])
        SqlPickSessions(database).replace_demo_sessions([])
        inventory.remove_imported_catalog(layout)
        database.dispose()
        print(f"Removed the demo data from {where}")
        return 0

    catalog = read_pos_export(POS_EXPORT)
    placeholders = {product.barcode for product in layout.products}
    inventory.import_catalog(layout.id, catalog, retire_barcodes=placeholders)

    now = datetime.now(UTC)
    rng = random.Random()
    reports = build_events(layout, now, rng)
    misses = build_misses(now, rng)
    trips = build_trips(layout, now, rng)
    events.replace_demo_events(reports, build_closed_events(layout, now, rng))
    analytics.replace_demo_data(misses, trips)
    SqlPickSessions(database).replace_demo_sessions(build_pick_sessions(layout.id, now, rng))
    database.dispose()
    print(
        f"Seeded {len(catalog)} catalog items, {len(reports)} reports, "
        f"{len(misses)} unfulfilled searches and {len(trips)} trips into {where}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
