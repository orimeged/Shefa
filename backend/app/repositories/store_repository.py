"""Floor plans and the dictionary, from files. Inventory lives in the database."""

import json
from pathlib import Path
from typing import Protocol

from app.domain.dictionary import FoodDictionary
from app.domain.models import Department, Store


class StoreRepository(Protocol):
    def list_stores(self) -> list[Store]: ...


class JsonStoreRepository:
    """Loads one store from each JSON file in a directory.

    Its categories and products only seed a new store's inventory.
    """

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir

    def list_stores(self) -> list[Store]:
        return [
            Store.model_validate_json(path.read_text(encoding="utf-8"))
            for path in sorted(self._data_dir.glob("*.json"))
        ]


def load_dictionary(path: Path) -> FoodDictionary:
    """The everyday vocabulary of each category, shared by every store."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return FoodDictionary(
        {category_id: Department.model_validate(value) for category_id, value in raw.items()}
    )
