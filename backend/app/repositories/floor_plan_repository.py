"""The tile floor plan a manager draws, kept on the store's row."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import Engine, select, update

from app.domain.floor_plan import FloorPlan
from app.repositories.inventory_tables import StoreRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StoredFloorPlan:
    plan: FloorPlan
    saved_at: datetime


class SqlFloorPlanRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def saved_at(self, store_id: str) -> datetime | None:
        """When the store's plan was last saved; None if it has none. One small read."""
        with self._engine.connect() as connection:
            stamp = connection.scalar(
                select(StoreRecord.floor_plan_updated_at).where(StoreRecord.id == store_id)
            )
        return _aware(stamp)

    def load(self, store_id: str) -> StoredFloorPlan | None:
        with self._engine.connect() as connection:
            row = connection.execute(
                select(StoreRecord.floor_plan, StoreRecord.floor_plan_updated_at).where(
                    StoreRecord.id == store_id
                )
            ).first()
        if row is None or row.floor_plan is None or row.floor_plan_updated_at is None:
            return None
        try:
            plan = FloorPlan.model_validate(row.floor_plan)
        except ValidationError as error:
            # Only a hand edit of the database gets here: every save is checked first.
            logger.error("The floor plan saved for %s can't be read: %s", store_id, error)
            return None
        return StoredFloorPlan(plan, _aware(row.floor_plan_updated_at))

    def save(self, store_id: str, plan: FloorPlan, saved_at: datetime) -> bool:
        """False when the store doesn't exist."""
        with self._engine.begin() as connection:
            result = connection.execute(
                update(StoreRecord)
                .where(StoreRecord.id == store_id)
                .values(floor_plan=plan.model_dump(mode="json"), floor_plan_updated_at=saved_at)
            )
        return result.rowcount == 1


def _aware(stamp: datetime | None) -> datetime | None:
    """SQLite hands back times without their zone; every one stored here is UTC."""
    if stamp is None or stamp.tzinfo is not None:
        return stamp
    return stamp.replace(tzinfo=UTC)
