"""Finished picking sessions, in the app's database."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Engine, text

from app.domain.picking import PickSession
from app.repositories.event_store import DEMO_SESSION_PREFIX, TIMESTAMP_FORMAT

_INSERT = text(
    """
    INSERT INTO pick_sessions (id, store_id, started_at, finished_at, lines, missing)
    VALUES (:id, :store_id, :started_at, :finished_at, :lines, :missing)
    ON CONFLICT (id) DO NOTHING
    """
)


def _time(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime(TIMESTAMP_FORMAT)


def _row(session: PickSession, key: str | None = None) -> dict[str, object]:
    return {
        "id": key or str(session.id),
        "store_id": session.store_id,
        "started_at": _time(session.started_at),
        "finished_at": _time(session.finished_at),
        "lines": session.lines,
        "missing": session.missing,
    }


class SqlPickSessions:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def record(self, session: PickSession) -> bool:
        """False for an id already kept: the phone retried."""
        with self._engine.begin() as connection:
            return connection.execute(_INSERT, _row(session)).rowcount == 1

    def sessions(self, store_id: str, since: datetime, until: datetime) -> list[PickSession]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT id, store_id, started_at, finished_at, lines, missing FROM pick_sessions
                    WHERE store_id = :store AND finished_at >= :since AND finished_at < :until
                    ORDER BY finished_at
                    """
                ),
                {"store": store_id, "since": _time(since), "until": _time(until)},
            ).all()
        return [
            PickSession(
                # Demo rows carry a readable id; any id still has to parse as one.
                id=UUID(id_) if not id_.startswith(DEMO_SESSION_PREFIX) else UUID(id_.removeprefix(DEMO_SESSION_PREFIX)),
                store_id=store,
                started_at=datetime.fromisoformat(started),
                finished_at=datetime.fromisoformat(finished),
                lines=lines,
                missing=missing,
            )
            for id_, store, started, finished, lines, missing in rows
        ]

    def replace_demo_sessions(self, sessions: Sequence[PickSession]) -> None:
        """Swaps the last demo seed's sessions, in one transaction. Real ones aren't touched."""
        with self._engine.begin() as connection:
            connection.execute(text("DELETE FROM pick_sessions WHERE id LIKE :demo"), {"demo": f"{DEMO_SESSION_PREFIX}%"})
            if sessions:
                connection.execute(_INSERT, [_row(session, f"{DEMO_SESSION_PREFIX}{session.id}") for session in sessions])
