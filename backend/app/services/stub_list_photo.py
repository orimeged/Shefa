"""A local stand-in for reading list photos, for development with no API key.

Only used when LIST_PHOTO_ENGINE=stub is set. It never turns on by itself, because
it returns made-up items whatever the photo shows.
"""

from collections.abc import Sequence

_DEFAULT_LINES = ("2 חלב", "לחם", "ביצים", "עגבניות")


class StubListPhotoReader:
    def __init__(self, lines: Sequence[str] = _DEFAULT_LINES) -> None:
        self._lines = list(lines)

    async def read(self, image: bytes, content_type: str) -> list[str]:
        return self._lines
