"""Reading a photographed shopping list into its lines."""

from collections.abc import Iterable
from typing import Protocol

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# The same limits the phone's list parser works to.
_MAX_ITEMS = 100
_MAX_ITEM_LENGTH = 200


class ListPhotoError(Exception):
    """The photo couldn't be read."""


class ListPhotoReader(Protocol):
    async def read(self, image: bytes, content_type: str) -> list[str]: ...


def clean_lines(lines: Iterable[str]) -> list[str]:
    stripped = (line.strip()[:_MAX_ITEM_LENGTH] for line in lines)
    return [line for line in stripped if line][:_MAX_ITEMS]
