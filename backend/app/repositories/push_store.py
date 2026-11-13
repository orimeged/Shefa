"""Staff phones subscribed to a store's alerts, in the app's database."""

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import Engine, text

from app.repositories.event_store import TIMESTAMP_FORMAT
from app.services.push import PushSubscription


class SqlPushSubscriptions:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def save(self, store_id: str, subscription: PushSubscription) -> None:
        """A phone subscribing again, or for another store, replaces its row."""
        with self._engine.begin() as connection:
            connection.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :endpoint"), {"endpoint": subscription.endpoint})
            connection.execute(
                text(
                    """
                    INSERT INTO push_subscriptions (endpoint, store_id, p256dh, auth, created_at)
                    VALUES (:endpoint, :store_id, :p256dh, :auth, :created_at)
                    """
                ),
                {
                    "endpoint": subscription.endpoint,
                    "store_id": store_id,
                    "p256dh": subscription.p256dh,
                    "auth": subscription.auth,
                    "created_at": datetime.now(UTC).strftime(TIMESTAMP_FORMAT),
                },
            )

    def remove(self, endpoint: str) -> None:
        with self._engine.begin() as connection:
            connection.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :endpoint"), {"endpoint": endpoint})

    def for_store(self, store_id: str) -> Sequence[PushSubscription]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE store_id = :store ORDER BY created_at"),
                {"store": store_id},
            ).all()
        return [PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth) for endpoint, p256dh, auth in rows]
