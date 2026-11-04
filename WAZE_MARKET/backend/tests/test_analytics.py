from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.analytics import RouteTrip, SearchMiss, misses_in, route_edges
from app.domain.events import NotFoundEvent, NotFoundReport
from app.domain.models import ResolvedItem, SearchHit, Side
from app.main import create_app
from sqlalchemy.exc import OperationalError

from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.event_store import DEMO_SESSION_PREFIX, SqlEventStore
from tests.conftest import ADMIN_TOKEN, migrated_engine

SHOPPER = "/api/v1/stores/demo"
ANALYTICS = "/api/v1/admin/analytics"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
NOW = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def at_least(client: TestClient, path: str) -> dict[str, Any]:
    response = client.get(f"{ANALYTICS}/{path}", params={"store_id": "demo"}, headers=AUTH)
    assert response.status_code == 200
    return response.json()


def stores(client: TestClient) -> tuple[SqlAnalyticsStore, SqlEventStore]:
    return client.app.state.analytics, client.app.state.events


def miss(
    query: str,
    category: str | None = "dairy",
    *,
    session: str | None = None,
    ago: timedelta = timedelta(hours=1),
    store_id: str = "demo",
) -> SearchMiss:
    return SearchMiss(
        store_id=store_id,
        session_id=session or str(uuid4()),
        query=query,
        category_id=category,
        timestamp=datetime.now(UTC) - ago,
    )


def trip(
    edges: Sequence[tuple[str, str]],
    *,
    ago: timedelta = timedelta(hours=1),
    session: str | None = None,
) -> RouteTrip:
    return RouteTrip(
        store_id="demo",
        session_id=session or str(uuid4()),
        edges=tuple(edges),
        timestamp=datetime.now(UTC) - ago,
    )


def report(
    store: SqlEventStore,
    item: str = "חלב",
    *,
    at: tuple[float, float] = (6.0, 8.0),
    ago: timedelta = timedelta(hours=1),
    times: int = 1,
) -> None:
    for _ in range(times):
        store.append(
            NotFoundEvent.from_report(
                NotFoundReport(
                    store_id="demo",
                    session_id="shopper",
                    item_query=item,
                    category_id="dairy",
                    x_coord=at[0],
                    y_coord=at[1],
                    timestamp=datetime.now(UTC) - ago,
                )
            )
        )


def resolve(client: TestClient, lines: list[str], session: str | None = "trip-1") -> None:
    body: dict[str, Any] = {"lines": lines}
    if session:
        body["session_id"] = session
    assert client.post(f"{SHOPPER}/list/resolve", json=body).status_code == 200


def route(client: TestClient, categories: list[str], **extra: Any) -> dict[str, Any]:
    response = client.post(f"{SHOPPER}/routes", json={"category_ids": categories, **extra})
    assert response.status_code == 200
    return response.json()


def hit(category: str = "dairy") -> SearchHit:
    return SearchHit(
        category_id=category,
        category_name="x",
        category_name_en="x",
        aisle_no=1,
        side=Side.LEFT,
        matched_text="x",
        score=0.7,
    )


# ---- What counts as a miss


def test_an_item_with_no_match_is_a_miss() -> None:
    items = [ResolvedItem(line=0, text="נרות שבת", hit=None, source=None)]

    [found] = misses_in(items, "demo", "trip", NOW)

    assert (found.query, found.category_id) == ("נרות שבת", None)


def test_an_item_only_claude_could_place_is_a_miss_with_a_department() -> None:
    items = [ResolvedItem(line=0, text="חלב שקדים", hit=hit("dairy"), source="llm")]

    [found] = misses_in(items, "demo", "trip", NOW)

    assert found.category_id == "dairy"


def test_an_item_claude_matched_to_the_dictionary_is_no_miss() -> None:
    items = [
        ResolvedItem(
            line=0, text="בננות", hit=hit("produce"), source="llm", dictionary_id="produce:בננה"
        )
    ]

    assert misses_in(items, "demo", "trip", NOW) == []


def test_a_catalog_match_is_no_miss() -> None:
    items = [ResolvedItem(line=0, text="חלב", hit=hit(), source="catalog")]

    assert misses_in(items, "demo", "trip", NOW) == []


def test_punctuation_alone_is_no_miss() -> None:
    items = [ResolvedItem(line=0, text="?!", hit=None, source=None)]

    assert misses_in(items, "demo", "trip", NOW) == []


# ---- Capture


def test_a_list_records_what_it_couldnt_place(client: TestClient) -> None:
    resolve(client, ["נרות שבת", "חלב"])

    report_ = at_least(client, "lost-demand")

    assert [item["item"] for item in report_["items"]] == ["נרות שבת"]


def test_one_trip_counts_an_item_once(client: TestClient) -> None:
    resolve(client, ["נרות שבת"])
    resolve(client, ["נרות שבת!"])

    assert at_least(client, "lost-demand")["total"] == 1


def test_two_trips_count_twice(client: TestClient) -> None:
    resolve(client, ["נרות שבת"], "trip-1")
    resolve(client, ["נרות שבת"], "trip-2")

    assert at_least(client, "lost-demand")["items"][0]["times"] == 2


def test_a_list_with_no_session_still_counts(client: TestClient) -> None:
    resolve(client, ["נרות שבת"], None)
    resolve(client, ["נרות שבת"], None)

    assert at_least(client, "lost-demand")["total"] == 2


def test_searching_as_you_type_records_nothing(client: TestClient) -> None:
    for typed in ("נ", "נר", "נרו"):
        client.get(f"{SHOPPER}/search", params={"q": typed})

    assert at_least(client, "lost-demand")["total"] == 0


def test_a_route_is_recorded_as_a_trip(client: TestClient) -> None:
    planned = route(client, ["dairy"], session_id="trip-1")

    flow = at_least(client, "traffic-flow")

    walked = {
        frozenset((edge["from_node"], edge["to_node"]))
        for edge in flow["edges"]
        if edge["trips"] == 1
    }
    on_route = {
        frozenset((a["node_id"], b["node_id"]))
        for leg in planned["legs"]
        for a, b in pairwise(leg["points"])
    }
    assert flow["trips"] == 1
    assert walked == on_route


def test_replanning_doesnt_make_a_second_trip(client: TestClient) -> None:
    route(client, ["dairy", "bakery"], session_id="trip-1")
    route(client, ["bakery"], session_id="trip-1", start_node_id="a5_s2")
    route(client, ["bakery", "meat"], session_id="trip-1", start_node_id="a5_s2")

    flow = at_least(client, "traffic-flow")

    assert flow["trips"] == 1
    assert max(edge["trips"] for edge in flow["edges"]) == 1


def test_a_replanned_trip_adds_the_new_walkways(client: TestClient) -> None:
    route(client, ["produce"], session_id="trip-1")
    before = sum(edge["trips"] for edge in at_least(client, "traffic-flow")["edges"])

    route(client, ["meat"], session_id="trip-1", start_node_id="a1_s1")

    assert sum(edge["trips"] for edge in at_least(client, "traffic-flow")["edges"]) > before


def test_a_route_with_no_stops_is_no_trip(client: TestClient) -> None:
    route(client, ["gone"], session_id="trip-1")

    assert at_least(client, "traffic-flow")["trips"] == 0


def test_a_route_with_no_session_still_counts(client: TestClient) -> None:
    route(client, ["dairy"])
    route(client, ["dairy"])

    assert at_least(client, "traffic-flow")["trips"] == 2


@pytest.mark.parametrize("session", ["", "x" * 65])
def test_a_bad_session_id_is_refused(client: TestClient, session: str) -> None:
    body = {"category_ids": ["dairy"], "session_id": session}

    assert client.post(f"{SHOPPER}/routes", json=body).status_code == 422


def test_a_shopper_never_fails_because_of_analytics(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: object) -> None:
        raise OperationalError("INSERT", {}, Exception("database is locked"))

    monkeypatch.setattr(client.app.state.analytics, "record_trip", fail)
    monkeypatch.setattr(client.app.state.analytics, "record_misses", fail)

    route(client, ["dairy"])
    resolve(client, ["נרות שבת"])


def test_every_edge_of_a_route_is_named_the_same_way_round(client: TestClient) -> None:
    planned = client.app.state.stores.get("demo").plan_route(["produce", "meat"])

    assert all(first <= second for first, second in route_edges(planned))


# ---- Reports


@pytest.mark.parametrize(
    "path", ["summary", "lost-demand", "not-found-heatmap", "traffic-flow"]
)
def test_every_report_needs_the_token_and_a_real_store(client: TestClient, path: str) -> None:
    url = f"{ANALYTICS}/{path}"

    assert client.get(url, params={"store_id": "demo"}).status_code == 401
    assert client.get(url, params={"store_id": "nope"}, headers=AUTH).status_code == 404
    assert client.get(url, params={"store_id": "demo"}, headers=AUTH).status_code == 200


def test_lost_demand_ranks_items(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses([miss("טופו"), miss("קומבוצה"), miss("קומבוצה")])

    items = at_least(client, "lost-demand")["items"]

    assert [(item["item"], item["times"]) for item in items] == [("קומבוצה", 2), ("טופו", 1)]


def test_lost_demand_folds_spelling_variants_together(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses([miss("קומבוצ'ה"), miss("קומבוצ׳ה!"), miss("קומבוצ'ה")])

    assert len(at_least(client, "lost-demand")["items"]) == 1


def test_lost_demand_keeps_the_top_ten(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses([miss(f"פריט {index}") for index in range(14)])

    report_ = at_least(client, "lost-demand")

    assert len(report_["items"]) == 10
    assert report_["total"] == 14


def test_lost_demand_breaks_down_by_department(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses(
        [miss("א", "dairy"), miss("ב", "dairy"), miss("ג", "bakery"), miss("ד", None)]
    )

    categories = at_least(client, "lost-demand")["categories"]

    assert [(row["category_id"], row["times"]) for row in categories] == [
        ("dairy", 2),
        (None, 1),
        ("bakery", 1),
    ]
    assert sum(row["share"] for row in categories) == pytest.approx(1)
    dairy = next(row for row in categories if row["category_id"] == "dairy")
    assert dairy["share"] == 0.5
    assert dairy["category_name"] == "מוצרי חלב וביצים"
    assert dairy["category_name_en"] == "Dairy & Eggs"


def test_lost_demand_only_looks_back_a_week(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses([miss("ישן", ago=timedelta(days=8))])

    assert at_least(client, "lost-demand") == {"total": 0, "items": [], "categories": []}


def test_lost_demand_stays_in_its_store(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses([miss("טופו", store_id="other")])

    assert at_least(client, "lost-demand")["total"] == 0


def test_the_heatmap_counts_reports_at_a_spot(client: TestClient) -> None:
    _, events = stores(client)
    report(events, at=(6.1, 8.1), times=2)
    report(events, at=(20.0, 13.0))

    heat = at_least(client, "not-found-heatmap")

    assert heat["total"] == 3
    assert heat["points"][0] == {"x": 6.0, "y": 8.0, "count": 2}


def test_the_heatmap_cools_when_a_shelf_is_restocked(client: TestClient) -> None:
    _, events = stores(client)
    report(events)

    client.post(
        "/api/v1/admin/reports/not-found/resolve",
        json={"store_id": "demo", "item_query": "חלב", "category_id": "dairy"},
        headers=AUTH,
    )

    assert at_least(client, "not-found-heatmap")["points"] == []


def test_the_heatmap_only_looks_back_a_week(client: TestClient) -> None:
    _, events = stores(client)
    report(events, ago=timedelta(days=8))

    assert at_least(client, "not-found-heatmap")["total"] == 0


def test_traffic_lists_every_walkway_of_the_floor_plan(client: TestClient) -> None:
    flow = at_least(client, "traffic-flow")
    plan = client.app.state.stores.get("demo").store_map.edges

    assert [(edge["from_node"], edge["to_node"]) for edge in flow["edges"]] == [
        (edge.from_node, edge.to_node) for edge in plan
    ]
    assert {edge["trips"] for edge in flow["edges"]} == {0}


def test_traffic_ignores_the_direction_of_walking(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_trip(trip([("front_1", "front_0")]))

    flow = at_least(client, "traffic-flow")

    walked = next(edge for edge in flow["edges"] if edge["trips"])
    assert {walked["from_node"], walked["to_node"]} == {"front_0", "front_1"}


def test_traffic_only_looks_back_a_week(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_trip(trip([("front_0", "front_1")], ago=timedelta(days=8)))

    flow = at_least(client, "traffic-flow")

    assert flow["trips"] == 0
    assert max(edge["trips"] for edge in flow["edges"]) == 0


# ---- The figures


def test_routes_today_compare_with_the_same_hours_last_week(tmp_path: Path) -> None:
    analytics = SqlAnalyticsStore(migrated_engine(tmp_path / "e.sqlite3"))
    day_start = datetime(2026, 11, 1, 0, 0, tzinfo=UTC)
    moments = [
        ("today", NOW - timedelta(hours=1)),
        ("yesterday", day_start - timedelta(hours=1)),
        ("last week, same hours", NOW - timedelta(days=7, hours=2)),
        ("last week, same hours too", NOW - timedelta(days=7, hours=3)),
        ("last week, later that day", NOW - timedelta(days=7) + timedelta(hours=3)),
    ]
    for name, moment in moments:
        analytics.record_trip(
            RouteTrip(store_id="demo", session_id=name, edges=(), timestamp=moment)
        )

    counts = analytics.dashboard_counts("demo", NOW, day_start)

    assert (counts.routes_today.current, counts.routes_today.previous) == (1, 2)


def test_today_starts_at_the_stores_midnight(settings: Settings) -> None:
    local = replace(settings, store_timezone="Asia/Jerusalem")
    with TestClient(create_app(local)) as client:
        analytics, _ = stores(client)
        now = datetime.now(UTC)
        midnight = now.astimezone(client.app.state.store_timezone).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        analytics.record_trip(
            trip([], session="before-midnight", ago=now - midnight + timedelta(minutes=1))
        )

        assert at_least(client, "summary")["routes_today"]["current"] == 0


def test_searches_compare_with_the_week_before(client: TestClient) -> None:
    analytics, _ = stores(client)
    analytics.record_misses(
        [
            miss("א"),
            miss("ב"),
            miss("ג", ago=timedelta(days=9)),
            miss("ישן מדי", ago=timedelta(days=20)),
        ]
    )

    pair = at_least(client, "summary")["unfulfilled_searches"]

    assert pair == {"current": 2, "previous": 1}


def test_alerts_match_the_table_and_count_only_three_or_more(client: TestClient) -> None:
    _, events = stores(client)
    report(events, "חם", times=3)
    report(events, "פושר", times=2)

    table = client.get(
        "/api/v1/admin/reports/not-found", params={"store_id": "demo"}, headers=AUTH
    ).json()
    pair = at_least(client, "summary")["missing_alerts"]

    assert pair["current"] == sum(row["times_reported"] >= 3 for row in table) == 1


def test_a_closed_alert_leaves_the_figure(client: TestClient) -> None:
    _, events = stores(client)
    report(events, "חם", times=3)

    client.post(
        "/api/v1/admin/reports/not-found/resolve",
        json={"store_id": "demo", "item_query": "חם", "category_id": "dairy"},
        headers=AUTH,
    )

    assert at_least(client, "summary")["missing_alerts"]["current"] == 0


def test_last_weeks_alerts_count_as_they_stood_then(client: TestClient) -> None:
    _, events = stores(client)
    report(events, "היה פתוח", ago=timedelta(days=9), times=3)
    report(events, "נסגר מיד", ago=timedelta(days=9), times=3)
    events.resolve_not_found(
        "demo", "נסגר מיד", "dairy", datetime.now(UTC) - timedelta(days=8)
    )
    report(events, "נסגר רק אתמול", ago=timedelta(days=9), times=3)
    events.resolve_not_found(
        "demo", "נסגר רק אתמול", "dairy", datetime.now(UTC) - timedelta(days=1)
    )

    pair = at_least(client, "summary")["missing_alerts"]

    assert pair["previous"] == 2
    assert pair["current"] == 0


def test_a_figure_and_its_chart_always_agree(client: TestClient) -> None:
    analytics, _ = stores(client)
    local_time = datetime.now(timezone(timedelta(hours=3))) - timedelta(minutes=30)
    analytics.record_misses(
        [
            miss("א"),
            SearchMiss(
                store_id="demo",
                session_id="local-clock",
                query="ב",
                category_id=None,
                timestamp=local_time,
            ),
        ]
    )

    figure = at_least(client, "summary")["unfulfilled_searches"]["current"]

    assert figure == at_least(client, "lost-demand")["total"] == 2


def test_demo_rows_must_be_marked(tmp_path: Path) -> None:
    analytics = SqlAnalyticsStore(migrated_engine(tmp_path / "e.sqlite3"))

    with pytest.raises(ValueError, match=DEMO_SESSION_PREFIX):
        analytics.replace_demo_data([miss("אמיתי", session="a-real-shopper")], [])


def test_replacing_demo_data_leaves_real_shoppers_alone(tmp_path: Path) -> None:
    analytics = SqlAnalyticsStore(migrated_engine(tmp_path / "e.sqlite3"))
    analytics.record_misses([miss("אמיתי", session="a-real-shopper")])
    analytics.record_misses([miss("מדומה", session=f"{DEMO_SESSION_PREFIX}1")])

    analytics.replace_demo_data([], [])

    assert [row.query for row in analytics.top_misses("demo", NOW - timedelta(days=30), 5)] == [
        "אמיתי"
    ]
