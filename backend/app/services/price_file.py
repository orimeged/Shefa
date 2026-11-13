"""Reads the price files Israeli chains must publish for every branch.

Under the price-transparency rules a chain with three or more stores posts each
branch's prices as XML, usually gzipped (`PriceFull<chain>-<store>-<time>.xml.gz`).
The chains don't agree on the wrapper: rows sit in `<Items><Item>`, `<Products>
<Product>` or `<Details><Line>`, and tag case varies. What they share is that each
row carries `ItemCode` (the barcode) and `ItemPrice` (shekels). So a row here is any
element with both, whatever it and its parent are called.

For a weighed item `ItemPrice` is per kilogram, which is still the right figure
to value a report with. A row without a usable price is skipped, not fatal: one
bad line in 20,000 shouldn't keep a store's other prices out.
"""

import gzip
import io
from xml.etree.ElementTree import ParseError

from defusedxml.ElementTree import iterparse

from app.domain.inventory import PriceLine
from app.services.pos_import import shekels_to_agorot

_GZIP_MAGIC = b"\x1f\x8b"
_CODE = "itemcode"
_PRICE = "itemprice"
_NAME = "itemname"


class PriceFileError(ValueError):
    """The upload isn't a price file this reader understands."""


def _local(tag: str) -> str:
    """The tag without a namespace, in lower case: chains differ in both."""
    return tag.rsplit("}", 1)[-1].lower()


def parse_price_file(data: bytes) -> list[PriceLine]:
    if data.startswith(_GZIP_MAGIC):
        try:
            data = gzip.decompress(data)
        except (OSError, EOFError) as error:
            raise PriceFileError("The file looks gzipped but doesn't decompress") from error

    lines: dict[str, PriceLine] = {}
    try:
        # Rows are read as they close and then dropped, so a 30 MB file stays small in memory.
        for _event, element in iterparse(io.BytesIO(data), events=("end",)):
            children = {_local(child.tag): (child.text or "").strip() for child in element}
            code, price_text = children.get(_CODE), children.get(_PRICE)
            if code is None or price_text is None:
                continue
            element.clear()
            price = shekels_to_agorot(price_text)
            if not code or price is None:
                continue
            # A branch can list an item twice; the last line is the newest.
            lines[code] = PriceLine(barcode=code, price_agorot=price, name=children.get(_NAME) or None)
    except ParseError as error:
        raise PriceFileError(f"Not valid XML: {error}") from error

    if not lines:
        raise PriceFileError("No rows with ItemCode and ItemPrice: not a price file")
    return list(lines.values())
