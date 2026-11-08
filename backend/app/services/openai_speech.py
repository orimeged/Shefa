"""Speech-to-text through OpenAI's transcription API."""

import logging

import openai

from app.domain.speech import (
    SUPPORTED_AUDIO_TYPES,
    TranscriptionError,
    base_content_type,
)

logger = logging.getLogger(__name__)

# whisper-1 and the gpt-4o transcribe models shut down on 2027-02-26, during the
# planned pilot, so the default is the model OpenAI recommends in their place.
DEFAULT_MODEL = "gpt-transcribe"

DEFAULT_TIMEOUT_SECONDS = 15.0

# Priming the model with the vocabulary it should expect. It matters most in a
# noisy aisle, where short Hebrew words are easy to mishear.
_PROMPTS = {
    "he": "רשימת קניות לסופרמרקט: חלב, לחם, ביצים, עגבניות, מלפפונים, קוטג', טחינה, קטשופ, במבה, נוטלה.",
    "en": "A supermarket shopping list: milk, bread, eggs, tomatoes, cucumbers, cheese, ketchup, coffee.",
}


class OpenAISpeechToText:
    def __init__(
        self,
        client: openai.AsyncOpenAI,
        model: str = DEFAULT_MODEL,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client.with_options(timeout=timeout_seconds, max_retries=1)
        self._model = model

    async def transcribe(self, audio: bytes, content_type: str, language: str) -> str:
        base_type = base_content_type(content_type)
        extension = SUPPORTED_AUDIO_TYPES.get(base_type)
        if extension is None:
            raise TranscriptionError(f"Unsupported audio type: {content_type}")

        # gpt-transcribe takes a list of languages. Older models take a single hint.
        hint = (
            {"languages": [language]}
            if self._model.startswith("gpt-transcribe")
            else {"language": language}
        )
        try:
            result = await self._client.audio.transcriptions.create(
                model=self._model,
                file=(f"segment{extension}", audio, base_type),
                prompt=_PROMPTS.get(language, ""),
                **hint,
            )
        except openai.AuthenticationError as error:
            logger.error("Transcription was refused, check OPENAI_API_KEY: %s", error)
            raise TranscriptionError("Authentication failed") from error
        except openai.APIConnectionError as error:
            logger.warning("Transcription didn't reach the API: %s", error)
            raise TranscriptionError("Connection failed") from error
        except openai.APIStatusError as error:
            logger.warning("Transcription got status %s: %s", error.status_code, error.message)
            raise TranscriptionError(f"Status {error.status_code}") from error
        return result.text
