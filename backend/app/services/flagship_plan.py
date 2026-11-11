"""The flagship demo store's floor plan: a 60 by 40 metre supermarket, drawn from the catalog.

Every shelf carries one of the catalog's subcategories, never a whole department, so
each product has a shelf of exactly its kind to be routed to: the apples to the fruit,
the cottage cheese to the cheese and yoghurt. The names come from the catalog itself,
so a shelf and the products on it can't be spelled two ways.

The layout follows how supermarkets are laid out. Fresh produce and bread are the
first thing past the door; refrigerated meat and dairy line the back wall, so a trip
for milk crosses the store; dry goods stand on gondolas up the middle, a department
to each, its two halves facing the aisles either side; frozen waits in freezers by
the tills, the last thing picked so it doesn't thaw; the tills are along the front.

Rows count from the back wall (row 0) to the front (row 39), as the editor draws them.
"""

from collections.abc import Mapping, Sequence

from app.domain.floor_plan import FloorPlan

ROWS = 40
COLS = 60
CELL_SIZE_M = 1.0

# Dry goods, from the door's side of the store to the far side.
GONDOLAS = (
    "cereals",
    "coffee",
    "sauces",
    "pasta",
    "canned",
    "snacks",
    "beverages",
    "baby",
    "toiletries",
    "cleaning",
)
GONDOLA_ROWS = (5, 22)
# Centred, with a wide walk round them along the walls.
FIRST_GONDOLA_COL = 6
# Two tiles of shelf, then three of aisle: wide enough for two trolleys to pass.
GONDOLA_PERIOD = 5

# Refrigerators along the back wall, one tile deep: department, first and last column.
BACK_WALL = (("meat", 2, 27), ("dairy", 30, 57))
BACK_WALL_ROW = 1

# Fresh tables by the door, and freezers by the tills, two tiles deep: department, first
# and last column. A department's first subcategory is the one nearer the back.
FRONT_TABLES = (("produce", 3, 14), ("bakery", 18, 29), ("frozen", 33, 44))
FRONT_TABLE_ROWS = ((27, 28), (31, 32))

# Six tills along the front, two tiles each, with lanes between.
TILL_ROW = 35
TILL_COLS = (33, 37, 41, 45, 49, 53)

# The door, in the front wall, by the fresh tables.
ENTRANCE_COLS = (4, 7)

Cell = tuple[int, int]


def _shares(first: int, last: int, parts: int) -> list[tuple[int, int]]:
    """`first`..`last` cut into `parts` stretches as even as whole tiles allow."""
    length = last - first + 1
    if parts > length:
        raise ValueError(f"{parts} subcategories won't fit in {length} tiles")
    bounds = [first + round(length * index / parts) for index in range(parts + 1)]
    return [(bounds[index], bounds[index + 1] - 1) for index in range(parts)]


def _gondola(col: int, names: Sequence[str]) -> dict[Cell, str]:
    """Two columns back to back: one subcategory each, or split along their length when there are more."""
    top, bottom = GONDOLA_ROWS
    columns = (col, col + 1)
    labels: dict[Cell, str] = {}
    if len(names) == 1:
        return {(row, c): names[0] for row in range(top, bottom + 1) for c in columns}
    per_column = [names[index::2] for index in range(2)]
    for c, mine in zip(columns, per_column, strict=True):
        for name, (start, end) in zip(mine, _shares(top, bottom, len(mine)), strict=True):
            labels.update({(row, c): name for row in range(start, end + 1)})
    return labels


def _wall(first: int, last: int, names: Sequence[str]) -> dict[Cell, str]:
    return {
        (BACK_WALL_ROW, col): name
        for name, (start, end) in zip(names, _shares(first, last, len(names)), strict=True)
        for col in range(start, end + 1)
    }


def _tables(first: int, last: int, names: Sequence[str]) -> dict[Cell, str]:
    """The two tables: one subcategory each, or each table split along its length."""
    labels: dict[Cell, str] = {}
    per_table = [names] * 2 if len(names) == 1 else [names[index::2] for index in range(2)]
    for rows, mine in zip(FRONT_TABLE_ROWS, per_table, strict=True):
        for name, (start, end) in zip(mine, _shares(first, last, len(mine)), strict=True):
            labels.update({(row, col): name for row in rows for col in range(start, end + 1)})
    return labels


def placed_departments() -> tuple[str, ...]:
    return (*GONDOLAS, *(department for department, _, _ in BACK_WALL), *(d for d, _, _ in FRONT_TABLES))


def flagship_labels(subcategories: Mapping[str, Sequence[str]]) -> dict[Cell, str]:
    """Every shelf tile and the subcategory on it.

    `subcategories` names each department's subcategories, in the catalog's order.
    Every department in it must have a place in the layout, and every place a
    department with at least one subcategory: a catalog this layout doesn't fit is
    an error, not a store with something missing.
    """
    placed = placed_departments()
    missing = sorted(set(subcategories) - set(placed))
    if missing:
        raise ValueError(f"no place in the flagship layout for: {', '.join(missing)}")
    empty = [department for department in placed if not subcategories.get(department)]
    if empty:
        raise ValueError(f"no subcategories for: {', '.join(empty)}")

    labels: dict[Cell, str] = {}
    for index, department in enumerate(GONDOLAS):
        labels.update(_gondola(FIRST_GONDOLA_COL + index * GONDOLA_PERIOD, subcategories[department]))
    for department, first, last in BACK_WALL:
        labels.update(_wall(first, last, subcategories[department]))
    for department, first, last in FRONT_TABLES:
        labels.update(_tables(first, last, subcategories[department]))
    return labels


def build_flagship_plan(subcategories: Mapping[str, Sequence[str]]) -> FloorPlan:
    """The plan, in the shape the editor saves and the server checks."""
    labels = flagship_labels(subcategories)
    tiles = [["aisle"] * COLS for _ in range(ROWS)]
    for row in range(ROWS):
        for col in range(COLS):
            if row in (0, ROWS - 1) or col in (0, COLS - 1):
                tiles[row][col] = "wall"
    first_door, last_door = ENTRANCE_COLS
    for col in range(first_door, last_door + 1):
        tiles[ROWS - 1][col] = "entrance"
    for col in TILL_COLS:
        tiles[TILL_ROW][col] = tiles[TILL_ROW][col + 1] = "checkout"
    for row, col in labels:
        tiles[row][col] = "shelf"
    return FloorPlan.model_validate(
        {
            "version": 1,
            "rows": ROWS,
            "cols": COLS,
            "cell_size_m": CELL_SIZE_M,
            "tiles": tiles,
            "labels": [{"row": row, "col": col, "label": label} for (row, col), label in sorted(labels.items())],
        }
    )
