"""Areas: where in the store a word shoppers write stands, finer than its department.

"מים" is a dictionary word for beverages, but the water stands in one quarter of one
shelf, and the department's nearest shelf may be the soft drinks. Where the store's
own products whose names begin with the word stand in a known quarter of a shelf, the
word becomes an area of its own, a place a route can go to: that quarter.

An area is named by its word, not by the shelf, so a manager who moves the water
moves the area with it.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable
from statistics import median_low

from app.domain.models import Category, Store
from app.domain.search_text import normalize

AREA_PREFIX = "area:"


def area_id(department_id: str, term: str) -> str:
    return f"{AREA_PREFIX}{department_id}:{term}"


def department_of_area(target_id: str) -> str | None:
    """The department an area belongs to, or None for anything that isn't one."""
    if not target_id.startswith(AREA_PREFIX):
        return None
    department_id, separator, term = target_id.removeprefix(AREA_PREFIX).partition(":")
    return department_id if separator and department_id and term else None


def term_areas(store: Store, terms: Iterable[tuple[str, str]]) -> tuple[Category, ...]:
    """An area for each (word, department) whose products stand in a known place.

    A product counts when its name starts with the word, whole words only ("מים" is
    "מים מינרליים" but not "מימיה"), it is placed on a subcategory's shelf and someone
    said which quarter. The area goes where most of them stand, the lower quarter on a tie,
    and is priced at their median, the lower one of an even count, for a basket's estimate:
    "במבה" is about a bag of Bamba, not halfway to the family pack.
    """
    departments = {category.id: category for category in store.categories}
    located: dict[str, list[tuple[tuple[str, ...], Category]]] = defaultdict(list)
    for product in store.product_stops:
        if product.department_id and product.subcategory and product.shelf_part is not None:
            located[product.department_id].append((tuple(normalize(product.name).split()), product))

    areas: dict[str, Category] = {}
    for term, department_id in terms:
        words = tuple(normalize(term).split())
        department = departments.get(department_id)
        # A comma would split the area's id in a shared link.
        if not words or department is None or "," in term:
            continue
        matching = [product for name, product in located[department_id] if name[: len(words)] == words]
        spots = Counter((product.subcategory, product.shelf_part) for product in matching)
        if not spots:
            continue
        prices = [product.price_agorot for product in matching if product.price_agorot is not None]
        (subcategory, part), _ = min(spots.items(), key=lambda spot: (-spot[1], spot[0][1] or 0, spot[0][0] or ""))
        found = area_id(department_id, term)
        areas.setdefault(
            found,
            Category(
                id=found,
                name=term,
                name_en=term,
                section_id=department.section_id,
                other_section_ids=department.other_section_ids,
                department_id=department_id,
                subcategory=subcategory,
                shelf_part=part,
                price_agorot=median_low(prices) if prices else None,
            ),
        )
    return tuple(areas.values())
