"""Reads the product export a store's point-of-sale system produces.

One CSV row per sellable item. Every problem is reported with its line number and
nothing is imported until the whole file reads clean, because a half-loaded catalog
sends shoppers to shelves that don't match it.
"""

import csv
import io
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.domain.inventory import CatalogRow, InvalidItemError

_COLUMNS = ("barcode", "department", "subcategory", "brand", "item", "size", "zone")
# Optional: an export without it imports as before, and leaves prices as they were.
_PRICE_COLUMN = "price"
_EAN13_LENGTH = 13
_AGOROT_PER_SHEKEL = 100


def ean13_is_valid(code: str) -> bool:
    """Scanners reject a wrong check digit, so a barcode failing it was mistyped."""
    if len(code) != _EAN13_LENGTH or not code.isascii() or not code.isdecimal():
        return False
    weighted = sum(int(digit) * (3 if index % 2 else 1) for index, digit in enumerate(code))
    return weighted % 10 == 0


def shekels_to_agorot(text: str) -> int | None:
    """"7.10", "7.1", "₪7.10" or "7" to agorot; None for anything that isn't a price."""
    cleaned = text.strip().replace("₪", "").replace(",", "").strip()
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
        return None
    return int(amount * _AGOROT_PER_SHEKEL)


def parse_pos_export(text: str) -> list[CatalogRow]:
    # Excel saves CSV with a byte order mark, which would otherwise join the first header.
    reader = csv.DictReader(io.StringIO(text.removeprefix("﻿")))
    missing = [column for column in _COLUMNS if column not in (reader.fieldnames or ())]
    if missing:
        raise InvalidItemError(f"Missing columns: {', '.join(missing)}")

    rows: list[CatalogRow] = []
    barcodes: set[str] = set()
    names: set[str] = set()
    has_prices = _PRICE_COLUMN in (reader.fieldnames or ())
    for line, raw in enumerate(reader, start=2):
        row = CatalogRow(**{column: (raw[column] or "").strip() for column in _COLUMNS})
        blank = [column for column in _COLUMNS if not getattr(row, column)]
        if blank:
            raise InvalidItemError(f"Line {line}: empty {', '.join(blank)}")
        price_text = (raw.get(_PRICE_COLUMN) or "").strip() if has_prices else ""
        if price_text:
            price = shekels_to_agorot(price_text)
            if price is None:
                raise InvalidItemError(f"Line {line}: not a price: {price_text}")
            row = row.model_copy(update={"price_agorot": price})
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
