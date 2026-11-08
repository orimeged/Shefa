"""Hands out each store's floor plan and its router, always the latest one saved."""

import threading
from dataclasses import dataclass
from datetime import UTC, datetime

from app.domain.floor_plan import FloorPlan
from app.domain.floor_routing import GridRouter
from app.repositories.floor_plan_repository import SqlFloorPlanRepository


@dataclass(frozen=True)
class LoadedFloorPlan:
    plan: FloorPlan
    saved_at: datetime
    router: GridRouter


class FloorPlanRegistry:
    """Rebuilds a store's router when a manager saves a new plan.

    The save time lives in the database, so with several server processes each
    one notices a new plan on its next request, as `StoreRegistry` does for
    inventory.
    """

    def __init__(self, repository: SqlFloorPlanRepository) -> None:
        self._repository = repository
        self._loaded: dict[str, LoadedFloorPlan] = {}
        self._lock = threading.Lock()

    def get(self, store_id: str) -> LoadedFloorPlan | None:
        saved_at = self._repository.saved_at(store_id)
        if saved_at is None:
            return None
        loaded = self._loaded.get(store_id)
        if loaded and loaded.saved_at == saved_at:
            return loaded

        with self._lock:
            loaded = self._loaded.get(store_id)
            if loaded and loaded.saved_at == saved_at:
                return loaded
            stored = self._repository.load(store_id)
            if stored is None:
                return None
            loaded = LoadedFloorPlan(stored.plan, stored.saved_at, GridRouter(stored.plan))
            self._loaded[store_id] = loaded
            return loaded

    def save(self, store_id: str, plan: FloorPlan) -> bool:
        """False when the store doesn't exist."""
        return self._repository.save(store_id, plan, datetime.now(UTC))
