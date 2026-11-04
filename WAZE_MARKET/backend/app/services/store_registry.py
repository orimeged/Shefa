"""Hands out each store's navigation, always matching the latest inventory."""

import threading
from collections.abc import Sequence

from app.domain.classifier import ItemClassifier
from app.domain.dictionary import FoodDictionary
from app.domain.models import Store
from app.repositories.inventory_repository import SqlInventoryRepository
from app.services.navigation import NavigationService


class StoreRegistry:
    """Rebuilds a store's search and routing when its inventory version moves.

    The version lives in the database, so this also holds with several server
    processes: each one notices a manager's change on its next request.
    """

    def __init__(
        self,
        layouts: Sequence[Store],
        inventory: SqlInventoryRepository,
        dictionary: FoodDictionary,
        classifier: ItemClassifier | None = None,
    ) -> None:
        self._layouts = {layout.id: layout for layout in layouts}
        self._inventory = inventory
        self._dictionary = dictionary
        self._classifier = classifier
        self._built: dict[str, tuple[int, NavigationService]] = {}
        self._lock = threading.Lock()

    def get(self, store_id: str) -> NavigationService | None:
        layout = self._layouts.get(store_id)
        if layout is None:
            return None
        # Read first: a change made during the build only costs one more rebuild.
        version = self._inventory.version(store_id)
        built = self._built.get(store_id)
        if built and built[0] == version:
            return built[1]

        with self._lock:
            built = self._built.get(store_id)
            if built and built[0] == version:
                return built[1]
            navigation = NavigationService(
                self._inventory.shopper_store(layout), self._dictionary, self._classifier
            )
            self._built[store_id] = (version, navigation)
            return navigation
