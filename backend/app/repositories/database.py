"""The app's one database: inventory, shoppers' reports and the dashboard's data.

SQLite on a laptop, PostgreSQL in the cloud, from the same `DATABASE_URL`. A
cloud host's disk is wiped on every deploy, so nothing worth keeping may live
in a file next to the app.
"""

from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event, make_url

_MIGRATIONS = Path(__file__).parent.parent.parent / "migrations"
_LOCK_WAIT_SECONDS = 5.0


def sqlalchemy_url(url: str) -> str:
    """Hosts hand out postgres:// URLs, which SQLAlchemy would read as a driver it doesn't have."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


def printable_url(url: str) -> str:
    """For logs and messages: the address without its password."""
    return make_url(sqlalchemy_url(url)).render_as_string(hide_password=True)


def create_database_engine(url: str) -> Engine:
    url = sqlalchemy_url(url)
    if not url.startswith("sqlite"):
        return create_engine(
            url,
            # A host closes idle connections, and the first request after must not fail.
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            # Poolers in transaction mode, like Supabase's on port 6543, can't keep
            # prepared statements: a connection may move to another server.
            connect_args={"prepare_threshold": None},
        )

    Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"timeout": _LOCK_WAIT_SECONDS})

    @event.listens_for(engine, "connect")
    def _configure(connection: Any, _record: Any) -> None:
        cursor = connection.cursor()
        # SQLite ignores foreign keys unless asked, on every connection.
        cursor.execute("PRAGMA foreign_keys=ON")
        # Shoppers keep reading while a manager saves.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine


def migrate(engine: Engine) -> None:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
