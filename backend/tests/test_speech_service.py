"""Speech to text for the dashboard's spoken inventory: the OpenAI engine and the budget around it."""

from typing import Any

import httpx
import openai
import pytest

from app.domain.speech import TranscriptionError
from app.services.openai_speech import OpenAISpeechToText
from app.services.stub_speech import StubSpeechToText
from app.services.transcription import TranscriptionService, clean_transcript

WEBM = b"\x1a\x45\xdf\xa3" + b"audio" * 20
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"audio" * 20


@pytest.mark.parametrize("phrase", ["תודה", "תודה רבה.", "Thank you.", "Thanks for watching!", "  you "])
def test_drops_what_speech_models_invent_on_noise(phrase: str) -> None:
    assert clean_transcript(phrase) == ""


def test_keeps_real_items() -> None:
    assert clean_transcript("  חלב  ") == "חלב"
    assert clean_transcript("תודה על החלב") == "תודה על החלב"


async def test_the_service_refuses_past_its_budget() -> None:
    service = TranscriptionService(StubSpeechToText(), calls_per_minute=1)

    await service.transcribe(WEBM, "audio/webm", "he")
    with pytest.raises(TranscriptionError):
        await service.transcribe(WEBM, "audio/webm", "he")


def engine_with(handler: Any, model: str = "gpt-transcribe") -> tuple[OpenAISpeechToText, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = openai.AsyncOpenAI(
        api_key="test-key",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    return OpenAISpeechToText(client, model), requests


async def test_openai_sends_a_named_file_and_the_language_list() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "חלב"}))

    assert await engine.transcribe(WEBM, "audio/webm;codecs=opus", "he") == "חלב"

    request = requests[0]
    body = request.content
    assert request.url.path.endswith("/audio/transcriptions")
    assert b'filename="segment.webm"' in body
    assert b"gpt-transcribe" in body
    assert b'name="languages[]"' in body or b'name="languages"' in body
    assert WEBM in body


async def test_older_models_get_the_single_language_hint() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "milk"}), "whisper-1")

    await engine.transcribe(MP4, "audio/mp4", "en")

    body = requests[0].content
    assert b'name="language"' in body
    assert b'filename="segment.mp4"' in body


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_openai_failures_become_transcription_errors(status: int) -> None:
    engine, _ = engine_with(lambda _: httpx.Response(status, json={"error": {"message": "x"}}))

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/webm", "he")


async def test_a_lost_connection_becomes_a_transcription_error() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    engine, _ = engine_with(fail)

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/webm", "he")


async def test_refuses_a_type_it_cant_name() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "x"}))

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/ogg", "he")

    assert requests == []
