"""Reads the product export a store's point-of-sale system produces.

One CSV row per sellable item. Every problem is reported with its line number and
nothing is imported until the whole file reads clean, because a half-loaded catalog
sends shoppers to shelves that don't match it.
"""

import csv
import io
from pathlib import Path

from app.domain.inventory import CatalogRow, InvalidItemError

_COLUMNS = ("barcode", "department", "subcategory", "brand", "item", "size", "zone")
_EAN13_LENGTH = 13


def ean13_is_valid(code: str) -> bool:
    """Scanners reject a wrong check digit, so a barcode failing it was mistyped."""
    if len(code) != _EAN13_LENGTH or not code.isascii() or not code.isdecimal():
        return False
    weighted = sum(int(digit) * (3 if index % 2 else 1) for index, digit in enumerate(code))
    return weighted % 10 == 0


def parse_pos_export(text: str) -> list[CatalogRow]:
    # Excel saves CSV with a byte order mark, which would otherwise join the first header.
    reader = csv.DictReader(io.StringIO(text.removeprefix("﻿")))
    missing = [column for column in _COLUMNS if column not in (reader.fieldnames or ())]
    if missing:
        raise InvalidItemError(f"Missing columns: {', '.join(missing)}")

    rows: list[CatalogRow] = []
    barcodes: set[str] = set()
    names: set[str] = set()
    for line, raw in enumerate(reader, start=2):
        row = CatalogRow(**{column: (raw[column] or "").strip() for column in _COLUMNS})
        blank = [column for column in _COLUMNS if not getattr(row, column)]
        if blank:
            raise InvalidItemError(f"Line {line}: empty {', '.join(blank)}")
        if not ean13_is_valid(row.barcode):
            raise InvalidItemError(f"Line {line}: not an EAN-13 barcode: {row.barcode}")
        if row.barcode in barcodes:
            raise InvalidItemError(f"Line {line}: barcode appears twice: {row.barcode}")
        if row.display_name in names:
            raise InvalidItemError(f"Line {line}: item appears twice: {row.display_name}")
        barcodes.add(row.barcode)
        names.add(row.display_name)
        rows.append(row)
    return rows


def read_pos_export(path: Path) -> list[CatalogRow]:
    return parse_pos_export(path.read_text(encoding="utf-8"))
