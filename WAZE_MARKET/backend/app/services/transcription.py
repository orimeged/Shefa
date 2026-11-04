"""Speech-to-text as the app uses it: cost limits and transcript clean-up."""

import asyncio

from app.domain.budget import CallBudget
from app.domain.search_text import normalize
from app.domain.speech import SpeechToText, TranscriptionError

_MAX_CALLS_PER_MINUTE = 120
_MAX_CONCURRENT_CALLS = 8

# What speech models are known to write on noise and silence, learned from video
# subtitles. The app filters quiet audio out first, but a supermarket isn't quiet.
_PHANTOM_PHRASES = frozenset(
    normalize(phrase)
    for phrase in (
        "תודה",
        "תודה רבה",
        "תודה שצפיתם",
        "תודה על הצפייה",
        "כתוביות",
        "thank you",
        "thanks",
        "thanks for watching",
        "thank you for watching",
        "you",
    )
)


def clean_transcript(text: str) -> str:
    return "" if normalize(text) in _PHANTOM_PHRASES else text.strip()


class TranscriptionService:
    def __init__(
        self,
        engine: SpeechToText,
        calls_per_minute: int = _MAX_CALLS_PER_MINUTE,
        max_concurrent: int = _MAX_CONCURRENT_CALLS,
    ) -> None:
        self._engine = engine
        self._budget = CallBudget(calls_per_minute)
        self._slots = asyncio.Semaphore(max_concurrent)

    async def transcribe(self, audio: bytes, content_type: str, language: str) -> str:
        if not self._budget.try_spend():
            raise TranscriptionError("Over the call budget")
        async with self._slots:
            return clean_transcript(await self._engine.transcribe(audio, content_type, language))
