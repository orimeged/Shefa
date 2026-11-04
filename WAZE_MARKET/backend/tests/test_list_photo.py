"""Reading a photographed shopping list, from the upload to the model's answer."""

import base64
import json
from dataclasses import replace
from typing import Any

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.list_photo import ListPhotoError, clean_lines
from app.main import create_app
from app.services.openai_list_photo import OpenAIListPhotoReader

PHOTO = b"\xff\xd8\xff\xe0" + b"jpeg" * 50
URL = "/api/v1/list/photo"
JPEG = {"Content-Type": "image/jpeg"}


def upload(client: TestClient, body: bytes = PHOTO, headers: dict[str, str] = JPEG) -> httpx.Response:
    return client.post(URL, content=body, headers=headers)


def test_a_photo_comes_back_as_lines(client: TestClient) -> None:
    response = upload(client)

    assert response.status_code == 200
    assert response.json() == {"items": ["2 חלב", "לחם", "ביצים", "עגבניות"]}


def test_a_content_type_with_parameters_is_accepted(client: TestClient) -> None:
    assert upload(client, headers={"Content-Type": "IMAGE/JPEG; q=0.8"}).status_code == 200


def test_it_is_off_without_an_engine(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, list_photo_engine="none"))) as client:
        assert upload(client).status_code == 503


def test_a_file_that_isnt_an_image_is_refused(client: TestClient) -> None:
    assert upload(client, headers={"Content-Type": "application/pdf"}).status_code == 415


def test_an_empty_upload_is_refused(client: TestClient) -> None:
    assert upload(client, body=b"").status_code == 400


def test_an_oversized_photo_never_reaches_the_paid_model(client: TestClient) -> None:
    reader = client.app.state.list_photo_reader
    calls: list[bytes] = []

    async def counting_read(image: bytes, content_type: str) -> list[str]:
        calls.append(image)
        return []

    client.app.state.list_photo_reader = type("Reader", (), {"read": staticmethod(counting_read)})()
    try:
        assert upload(client, body=b"x" * (8 * 1024 * 1024 + 1)).status_code == 413
    finally:
        client.app.state.list_photo_reader = reader
    assert calls == []


def test_a_failed_read_is_a_bad_gateway(client: TestClient) -> None:
    async def failing_read(image: bytes, content_type: str) -> list[str]:
        raise ListPhotoError("No answer")

    client.app.state.list_photo_reader = type("Reader", (), {"read": staticmethod(failing_read)})()

    assert upload(client).status_code == 502


def test_lines_are_cleaned_and_capped() -> None:
    assert clean_lines(["  חלב ", "", "   ", "לחם"]) == ["חלב", "לחם"]
    assert len(clean_lines(["x"] * 150)) == 100
    assert len(clean_lines(["x" * 500])[0]) == 200


def reader_with(
    handler: Any, model: str = "gpt-5.4-mini"
) -> tuple[OpenAIListPhotoReader, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = openai.AsyncOpenAI(
        api_key="test-key",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    return OpenAIListPhotoReader(client, model), requests


def answer(text: str, status: str = "completed") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "resp_1",
            "object": "response",
            "created_at": 1,
            "model": "vision-model",
            "status": status,
            "parallel_tool_calls": False,
            "tool_choice": "none",
            "tools": [],
            "output": [
                {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": text, "annotations": []}],
                },
            ],
        },
    )


async def test_openai_gets_the_image_and_keeps_nothing() -> None:
    reader, requests = reader_with(lambda _: answer('{"items": ["חלב", "2 לחם"]}'))

    assert await reader.read(PHOTO, "image/jpeg") == ["חלב", "2 לחם"]

    request = requests[0]
    body = json.loads(request.content)
    image = body["input"][0]["content"][0]
    encoded = base64.b64encode(PHOTO).decode("ascii")
    assert request.url.path.endswith("/responses")
    assert body["model"] == "gpt-5.4-mini"
    assert body["reasoning"] == {"effort": "low"}
    assert body["store"] is False
    assert image["type"] == "input_image"
    assert image["image_url"] == f"data:image/jpeg;base64,{encoded}"
    assert body["text"]["format"]["type"] == "json_schema"


async def test_a_model_without_reasoning_isnt_sent_the_setting() -> None:
    reader, requests = reader_with(lambda _: answer('{"items": ["חלב"]}'), "gpt-4.1-mini")

    await reader.read(PHOTO, "image/jpeg")

    assert "reasoning" not in json.loads(requests[0].content)


async def test_a_photo_that_isnt_a_list_has_no_items() -> None:
    reader, _ = reader_with(lambda _: answer('{"items": []}'))

    assert await reader.read(PHOTO, "image/jpeg") == []


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_openai_failures_become_read_errors(status: int) -> None:
    reader, _ = reader_with(lambda _: httpx.Response(status, json={"error": {"message": "x"}}))

    with pytest.raises(ListPhotoError):
        await reader.read(PHOTO, "image/jpeg")


async def test_a_lost_connection_becomes_a_read_error() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    reader, _ = reader_with(fail)

    with pytest.raises(ListPhotoError):
        await reader.read(PHOTO, "image/jpeg")
