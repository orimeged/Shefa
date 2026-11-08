"""The seam for speech-to-text. A hosted API, a local model or a test stub all fit."""

from typing import Protocol

SUPPORTED_AUDIO_TYPES = {"audio/webm": ".webm", "audio/mp4": ".mp4"}
SUPPORTED_LANGUAGES = {"he", "en"}


class TranscriptionError(Exception):
    """The engine couldn't turn this audio into text."""


class SpeechToText(Protocol):
    async def transcribe(self, audio: bytes, content_type: str, language: str) -> str:
        """The text of one complete audio file."""
        ...


def base_content_type(mime_type: str) -> str:
    """"audio/webm;codecs=opus" to "audio/webm"."""
    return mime_type.split(";", 1)[0].strip().lower()
