"""The everyday vocabulary of each department, with a stable id for every term."""

from collections.abc import Iterator, Mapping

from app.domain.models import Department
from app.domain.search_text import normalize

NO_MATCH = "none"
_SEPARATOR = ":"


def dictionary_id(category_id: str, term: str) -> str:
    """Built from the term itself, so ids survive reordering or extending the file."""
    return f"{category_id}{_SEPARATOR}{normalize(term)}"


class FoodDictionary:
    def __init__(self, departments: Mapping[str, Department]) -> None:
        self._departments = dict(departments)
        self._category_by_id = {
            dictionary_id(category_id, term): category_id
            for category_id, department in self._departments.items()
            for term in department.terms
        }

    @property
    def departments(self) -> Mapping[str, Department]:
        return self._departments

    @property
    def category_ids(self) -> list[str]:
        return list(self._departments)

    def terms(self) -> Iterator[tuple[str, str, str]]:
        """Every (term, category id, dictionary id)."""
        for category_id, department in self._departments.items():
            for term in department.terms:
                yield term, category_id, dictionary_id(category_id, term)

    def limited_to(self, category_ids: set[str]) -> "FoodDictionary":
        return FoodDictionary(
            {key: value for key, value in self._departments.items() if key in category_ids}
        )

    def canonical_id(self, raw: str) -> str | None:
        """The known id `raw` refers to. Models echo a term as listed, final letters included."""
        category_id, separator, term = raw.partition(_SEPARATOR)
        if not separator:
            return None
        candidate = dictionary_id(category_id.strip(), term)
        return candidate if candidate in self._category_by_id else None

    def category_of(self, known_id: str) -> str | None:
        return self._category_by_id.get(known_id)

    def describe(self) -> str:
        """The vocabulary as plain lines, for a model to choose from."""
        return "\n".join(
            f"- {category_id} ({department.description}): {' | '.join(department.terms)}"
            for category_id, department in self._departments.items()
        )
