"""Floor plans drawn as text, so a test shows the store it walks.

`.` aisle, `#` wall, `E` entrance, `C` checkout counter, `S` a shelf with no
department, and any other letter a shelf whose department `labels` names.
"""

from collections.abc import Mapping
from typing import Any

from app.domain.floor_plan import FloorPlan

_KINDS = {".": "aisle", "#": "wall", "E": "entrance", "C": "checkout", "S": "shelf"}


def plan_payload(rows: list[str], labels: Mapping[str, str] | None = None) -> dict[str, Any]:
    """The JSON the dashboard's editor sends for this drawing."""
    names = labels or {}
    tiles = [[_KINDS.get(char, "shelf") for char in line] for line in rows]
    return {
        "version": 1,
        "rows": len(rows),
        "cols": len(rows[0]),
        "tiles": tiles,
        "labels": [
            {"row": row, "col": col, "label": names[char]}
            for row, line in enumerate(rows)
            for col, char in enumerate(line)
            if char not in _KINDS
        ],
    }


def plan_from(rows: list[str], labels: Mapping[str, str] | None = None) -> FloorPlan:
    return FloorPlan.model_validate(plan_payload(rows, labels))
