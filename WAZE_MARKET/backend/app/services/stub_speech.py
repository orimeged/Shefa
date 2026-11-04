"""A local stand-in for speech-to-text, for development with no API key.

Only used when STT_ENGINE=stub is set. It never turns on by itself, because it
returns made-up words and those would land on a real shopper's list.
"""

from collections.abc import Sequence
from itertools import cycle

from app.domain.speech import TranscriptionError, base_content_type

_WEBM_SIGNATURE = b"\x1a\x45\xdf\xa3"
_MP4_SIGNATURE = b"ftyp"
_DEFAULT_LINES = ("חלב", "לחם", "ביצים", "קפה", "עגבניות")


class StubSpeechToText:
    """Checks that each segment is a real file, then answers from a fixed list."""

    def __init__(self, lines: Sequence[str] = _DEFAULT_LINES) -> None:
        self._lines = cycle(lines)

    async def transcribe(self, audio: bytes, content_type: str, language: str) -> str:
        base_type = base_content_type(content_type)
        is_webm = base_type == "audio/webm" and audio.startswith(_WEBM_SIGNATURE)
        is_mp4 = base_type == "audio/mp4" and _MP4_SIGNATURE in audio[:16]
        if not is_webm and not is_mp4:
            raise TranscriptionError(f"Not a complete {base_type} file")
        return next(self._lines)
