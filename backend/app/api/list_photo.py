"""Reading a photographed shopping list.

The image is read and dropped: nothing here keeps it, and the shopper checks the
lines on the phone before any of them join the list.
"""

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.domain.list_photo import (
    SUPPORTED_IMAGE_TYPES,
    ListPhotoError,
    ListPhotoReader,
    clean_lines,
)

router = APIRouter(tags=["list"])

# The phone shrinks a photo to a few hundred kilobytes. This allows for a browser
# that can't, and stops anything larger before it's paid for.
_MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ListPhotoResponse(BaseModel):
    items: list[str]


@router.post("/api/v1/list/photo")
async def read_list_photo(
    request: Request,
    content_type: Annotated[str, Header()],
) -> ListPhotoResponse:
    # The upload is read before anything is refused. Answering mid-upload closes the
    # connection under the proxy in front, which reports a bad gateway instead, and
    # then the phone can't tell "photos are off" from "this photo failed".
    image = bytearray()
    async for chunk in request.stream():
        image += chunk
        if len(image) > _MAX_IMAGE_BYTES:
            raise HTTPException(413, "Image too large")

    reader: ListPhotoReader | None = request.app.state.list_photo_reader
    if reader is None:
        raise HTTPException(503, "Reading list photos isn't configured")
    base_type = content_type.split(";")[0].strip().lower()
    if base_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(415, "Unsupported image type")
    if not image:
        raise HTTPException(400, "Empty image")

    try:
        lines = await reader.read(bytes(image), base_type)
    except ListPhotoError as error:
        raise HTTPException(502, "The photo couldn't be read") from error
    return ListPhotoResponse(items=clean_lines(lines))
