"""The app on a real PostgreSQL, the way a cloud host runs it.

Skipped unless TEST_POSTGRES_URL points at one. Each test gets a schema of its
own and drops it after, so nothing already in that database is touched:

    docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=pw postgres:17-alpine
    TEST_POSTGRES_URL=postgresql://postgres:pw@localhost:55432/postgres pytest tests/test_postgres.py
"""

import os
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

import seed_demo_data
from app.config import Settings
from app.main import create_app
from app.repositories.database import create_database_engine, migrate, sqlalchemy_url
from app.repositories.inventory_tables import Base
from app.repositories.legacy_events import import_legacy_events
from tests.conftest import ADMIN_TOKEN

SERVER = os.environ.get("TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not SERVER, reason="TEST_POSTGRES_URL isn't set")

AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
SHOPPER = "/api/v1/stores/demo"
REPORTS = "/api/v1/admin/reports/not-found"
ANALYTICS = "/api/v1/admin/analytics"


@pytest.fixture()
def database_url() -> Iterator[str]:
    """A schema of the test's own, first on the search path."""
    schema = f"shefa_test_{uuid4().hex[:12]}"
    server = create_engine(sqlalchemy_url(SERVER or ""))
    with server.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    separator = "&" if "?" in (SERVER or "") else "?"
    yield f"{SERVER}{separator}options=-csearch_path%3D{schema}"
    with server.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    server.dispose()


@pytest.fixture()
def pg_client(settings: Settings, database_url: str) -> Iterator[TestClient]:
    with TestClient(create_app(replace(settings, database_url=database_url))) as client:
        yield client


def report(
    client: TestClient, item: str = "קטשופ", *, expect: int = 201, **overrides: Any
) -> dict[str, Any]:
    body = {
        "store_id": "demo",
        "session_id": "session-1",
        "item_query": item,
        "category_id": "sauces",
        "x_coord": 11.0,
        "y_coord": 8.0,
        **overrides,
    }
    response = client.post("/api/events/not-found", json=body)
    assert response.status_code == expect
    return response.json()


def admin(client: TestClient, path: str) -> Any:
    response = client.get(path, params={"store_id": "demo"}, headers=AUTH)
    assert response.status_code == 200
    return response.json()


def sql(database_url: str, statement: str) -> None:
    engine = create_database_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(statement))
    finally:
        engine.dispose()


# ---- Schema


def test_the_migrations_build_exactly_what_the_code_declares(database_url: str) -> None:
    engine = create_database_engine(database_url)
    migrate(engine)
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()

    assert differences == []


def test_migrating_twice_is_harmless(database_url: str) -> None:
    engine = create_database_engine(database_url)
    migrate(engine)
    migrate(engine)
    engine.dispose()


def test_a_hosts_postgres_url_is_understood() -> None:
    assert sqlalchemy_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert sqlalchemy_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert sqlalchemy_url("sqlite:///x.sqlite3") == "sqlite:///x.sqlite3"


# ---- Shoppers' reports


def test_a_report_is_kept_and_listed(pg_client: TestClient) -> None:
    report(pg_client)
    report(pg_client)

    rows = admin(pg_client, REPORTS)

    assert [(row["item_query"], row["times_reported"]) for row in rows] == [("קטשופ", 2)]


def test_a_retry_counts_once(pg_client: TestClient) -> None:
    event_id = str(uuid4())
    first = report(pg_client, event_id=event_id)
    # A retry is answered 200: it isn't a new report.
    second = report(pg_client, expect=200, event_id=event_id)

    assert (first["stored"], second["stored"]) == (True, False)


def test_closing_an_alert_takes_it_off_the_report(pg_client: TestClient) -> None:
    report(pg_client)
    body = {"store_id": "demo", "item_query": "קטשופ", "category_id": "sauces"}

    assert pg_client.post(f"{REPORTS}/resolve", json=body, headers=AUTH).json() == {"resolved": 1}
    assert admin(pg_client, REPORTS) == []


def test_an_item_with_no_department_can_be_closed(pg_client: TestClient) -> None:
    report(pg_client, "קומבוצה", category_id=None)
    body = {"store_id": "demo", "item_query": "קומבוצה", "category_id": None}

    assert pg_client.post(f"{REPORTS}/resolve", json=body, headers=AUTH).json() == {"resolved": 1}


@pytest.mark.parametrize(
    "change", ["item_query = 'x'", "x_coord = 0", "timestamp = 'x'", "category_id = NULL"]
)
def test_what_a_shopper_reported_can_never_change(
    pg_client: TestClient, database_url: str, change: str
) -> None:
    report(pg_client)

    with pytest.raises(DBAPIError, match="append-only"):
        sql(database_url, f"UPDATE not_found_events SET {change}")


def test_a_closed_alert_stays_closed(pg_client: TestClient, database_url: str) -> None:
    report(pg_client)
    body = {"store_id": "demo", "item_query": "קטשופ", "category_id": "sauces"}
    pg_client.post(f"{REPORTS}/resolve", json=body, headers=AUTH)

    with pytest.raises(DBAPIError, match="append-only"):
        sql(database_url, "UPDATE not_found_events SET resolved_at = NULL")


def test_a_real_report_cant_be_deleted(pg_client: TestClient, database_url: str) -> None:
    report(pg_client)

    with pytest.raises(DBAPIError, match="append-only"):
        sql(database_url, "DELETE FROM not_found_events")


def test_demo_rows_can_be_deleted(pg_client: TestClient, database_url: str) -> None:
    report(pg_client, session_id="demo-seed-1")

    sql(database_url, "DELETE FROM not_found_events WHERE session_id LIKE 'demo-seed-%'")

    assert admin(pg_client, REPORTS) == []


# ---- The dashboard


def test_trips_searches_and_reports_reach_the_dashboard(pg_client: TestClient) -> None:
    pg_client.post(f"{SHOPPER}/routes", json={"category_ids": ["dairy", "coffee"], "session_id": "t1"})
    pg_client.post(f"{SHOPPER}/list/resolve", json={"lines": ["קומבוצה"], "session_id": "t1"})
    for _ in range(3):
        report(pg_client, "חלב", category_id="dairy", x_coord=6.2, y_coord=8.1)

    summary = admin(pg_client, f"{ANALYTICS}/summary")
    lost = admin(pg_client, f"{ANALYTICS}/lost-demand")
    heat = admin(pg_client, f"{ANALYTICS}/not-found-heatmap")
    traffic = admin(pg_client, f"{ANALYTICS}/traffic-flow")

    assert summary["routes_today"]["current"] == 1
    assert summary["unfulfilled_searches"]["current"] == lost["total"] == 1
    assert summary["missing_alerts"]["current"] == 1
    assert [item["item"] for item in lost["items"]] == ["קומבוצה"]
    assert heat["total"] == 3 and heat["points"][0]["count"] == 3
    # Half-metre cells: 6.2 rounds to 6.0, 8.1 to 8.0.
    assert (heat["points"][0]["x"], heat["points"][0]["y"]) == (6.0, 8.0)
    assert traffic["trips"] == 1 and max(edge["trips"] for edge in traffic["edges"]) == 1


def test_the_seed_script_fills_a_postgres_dashboard(
    database_url: str, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", database_url)

    assert seed_demo_data.main([]) == 0
    assert seed_demo_data.main([]) == 0

    with TestClient(create_app(replace(settings, database_url=database_url))) as client:
        summary = admin(client, f"{ANALYTICS}/summary")
        lost = admin(client, f"{ANALYTICS}/lost-demand")
        assert summary["unfulfilled_searches"]["current"] == lost["total"] > 0
        assert summary["missing_alerts"]["current"] > 0
        assert len(admin(client, REPORTS)) > 0

    assert seed_demo_data.main(["--clear"]) == 0
    with TestClient(create_app(replace(settings, database_url=database_url))) as client:
        assert admin(client, REPORTS) == []


def test_the_seed_never_prints_the_password(
    database_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", database_url)
    seed_demo_data.main([])

    password = sqlalchemy_url(database_url).split(":")[2].split("@")[0]
    assert password not in capsys.readouterr().out


# ---- Moving in, and staying up


def test_an_old_events_file_moves_into_postgres(database_url: str, tmp_path: Path) -> None:
    old = tmp_path / "events.sqlite3"
    connection = sqlite3.connect(old)
    connection.executescript(
        """
        CREATE TABLE not_found_events (
            event_id TEXT PRIMARY KEY, store_id TEXT, session_id TEXT, item_query TEXT,
            category_id TEXT, x_coord REAL, y_coord REAL, timestamp TEXT, resolved_at TEXT
        );
        INSERT INTO not_found_events VALUES
            ('id-1', 'demo', 's', 'חלב', 'dairy', 1.0, 2.0, '2026-11-01T10:00:00.000000Z', NULL);
        """
    )
    connection.commit()
    connection.close()
    engine = create_database_engine(database_url)
    migrate(engine)

    assert import_legacy_events(engine, old) == 1
    assert import_legacy_events(engine, old) == 0
    engine.dispose()


def test_the_health_check_asks_the_database(pg_client: TestClient) -> None:
    assert pg_client.get("/health").json() == {"status": "ok"}


# ---- The dashboard's floor plan


def test_a_floor_plan_is_kept_as_jsonb_and_routes(pg_client: TestClient, database_url: str) -> None:
    from tests.floor_plans import plan_payload

    payload = plan_payload(
        ["E....", ".dd..", ".....", ".kk..", "....C"], {"d": "Dairy & Eggs", "k": "קומבוצה"}
    )
    saved = pg_client.put("/api/v1/stores/demo/floor-plan", json=payload, headers=AUTH)
    assert saved.status_code == 200
    body = pg_client.get("/api/v1/stores/demo/floor-plan").json()
    assert body["floor_plan"]["labels"] == payload["labels"]
    assert body["updated_at"] == saved.json()["updated_at"]

    engine = create_database_engine(database_url)
    try:
        with engine.connect() as connection:
            data_type = connection.scalar(
                text(
                    "SELECT data_type FROM information_schema.columns WHERE table_schema ="
                    " current_schema() AND table_name = 'stores' AND column_name = 'floor_plan'"
                )
            )
            # Stored parsed, so the database itself can look inside it.
            last_label = connection.scalar(
                text("SELECT floor_plan -> 'labels' -> -1 ->> 'label' FROM stores WHERE id = 'demo'")
            )
    finally:
        engine.dispose()
    assert data_type == "jsonb"
    assert last_label == "קומבוצה"

    route = pg_client.post("/api/v1/stores/demo/floor-plan/routes", json={"category_ids": ["dairy"]})
    assert route.status_code == 200
    assert route.json()["stops"][0]["department"] == "Dairy & Eggs"
