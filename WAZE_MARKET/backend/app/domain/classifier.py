"""The seam for smart categorization. Anything that sorts text into departments fits."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.domain.dictionary import FoodDictionary


@dataclass(frozen=True, slots=True)
class ClassifiedItem:
    text: str
    # None when the store doesn't carry this kind of thing.
    category_id: str | None
    # The closest dictionary term, when one means the same thing.
    dictionary_id: str | None = None


class ItemClassifier(Protocol):
    def classify(
        self, lines: Sequence[str], dictionary: FoodDictionary
    ) -> dict[str, list[ClassifiedItem]]:
        """Split and sort list lines, keyed by line.

        A line it can't answer is left out, and the caller keeps the result it
        already has. It must never raise: a shopping list can't depend on it.
        """
        ...
