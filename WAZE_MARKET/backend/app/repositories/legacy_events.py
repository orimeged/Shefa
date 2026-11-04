"""One-time copy of an events file from before migration 0003.

Reports, searches and trips used to live in a SQLite file of their own
(EVENTS_DB_PATH). A database that already has any of them is left alone, so this
runs once and a restart can't double anything.
"""

import logging
import sqlite3
from pathlib import Path

from sqlalchemy import Engine, text

logger = logging.getLogger(__name__)

_COLUMNS = {
    "not_found_events": (
        "event_id", "store_id", "session_id", "item_query",
        "category_id", "x_coord", "y_coord", "timestamp", "resolved_at",
    ),
    "search_misses": ("store_id", "session_id", "query_key", "query", "category_id", "timestamp"),
    "trips": ("store_id", "session_id", "timestamp"),
    "trip_edges": ("store_id", "session_id", "node_a", "node_b", "timestamp"),
}


def import_legacy_events(engine: Engine, path: Path) -> int:
    """Copies the old file's rows in, if there is one and the database has none yet. Returns how many."""
    if not path.is_file():
        return 0
    with engine.connect() as connection:
        for table in _COLUMNS:
            if connection.execute(text(f"SELECT 1 FROM {table} LIMIT 1")).first():
                return 0

    source = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        present = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        copied = 0
        with engine.begin() as connection:
            for table, wanted in _COLUMNS.items():
                if table not in present:
                    continue
                # A file from before alerts could be closed has no resolved_at.
                existing = {row[1] for row in source.execute(f"PRAGMA table_info({table})")}
                columns = [column for column in wanted if column in existing]
                rows = [
                    dict(zip(columns, values, strict=True))
                    for values in source.execute(f"SELECT {', '.join(columns)} FROM {table}")
                ]
                if rows:
                    names = ", ".join(columns)
                    params = ", ".join(f":{column}" for column in columns)
                    connection.execute(
                        text(f"INSERT INTO {table} ({names}) VALUES ({params}) ON CONFLICT DO NOTHING"),
                        rows,
                    )
                    copied += len(rows)
    finally:
        source.close()
    if copied:
        logger.info("Copied %d rows from %s into the database", copied, path)
    return copied
