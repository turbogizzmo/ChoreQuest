"""Chore photo proof.

Completing with a photo used to crash (``os`` was not imported), and the
stored file kept whatever extension the client sent, so a kid could plant
same-origin .html/.js files. The extension now comes from the image bytes.
"""

import os
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.models import AssignmentStatus, ChoreAssignment, UserRole
from backend.routers import uploads as uploads_router
from backend.routers.chores import complete_chore
from backend.routers.uploads import get_upload, sniff_image_ext
from tests.unit.conftest import make_category, make_chore, make_user

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class _FakeUpload:
    def __init__(self, filename: str, content: bytes, content_type: str = "image/png"):
        self.filename = filename
        self.content_type = content_type
        self.size = len(content)
        self._content = content

    async def read(self, size: int = -1) -> bytes:
        return self._content if size < 0 else self._content[:size]


@pytest.fixture()
def upload_dir(tmp_path):
    with patch.object(uploads_router, "UPLOAD_DIR", str(tmp_path)):
        yield tmp_path


async def _setup(db):
    cat = await make_category(db)
    parent = await make_user(db, "parent_pp", UserRole.parent)
    kid = await make_user(db, "kid_pp")
    chore = await make_chore(db, parent.id, cat.id)
    chore.max_completions_per_day = 5  # stay pending, so no parent notification
    db.add(ChoreAssignment(chore_id=chore.id, user_id=kid.id, date=date.today(),
                           status=AssignmentStatus.pending))
    await db.commit()
    return chore, kid


def test_sniff_image_ext():
    assert sniff_image_ext(PNG) == ".png"
    assert sniff_image_ext(b"\xff\xd8\xff\xe0rest") == ".jpg"
    assert sniff_image_ext(b"GIF89a....") == ".gif"
    assert sniff_image_ext(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ".webp"
    assert sniff_image_ext(b"<html><script>") is None
    assert sniff_image_ext(b"<svg xmlns=") is None


@pytest.mark.asyncio
async def test_photo_proof_saved_with_sniffed_extension(db, upload_dir):
    chore, kid = await _setup(db)
    with patch("backend.routers.chores.ws_manager") as ws:
        ws.send_to_parents = AsyncMock()
        resp = await complete_chore(chore.id, _FakeUpload("photo.html", PNG), db, kid)

    assert resp.photo_proof_path.endswith(".png")
    assert os.path.isfile(upload_dir / resp.photo_proof_path)


@pytest.mark.asyncio
@pytest.mark.parametrize("name,content", [
    ("payload.js", b"document.title=localStorage.getItem('x')"),
    ("page.html", b"<html><script src='/api/uploads/x.js'></script></html>"),
])
async def test_photo_proof_rejects_non_images(db, upload_dir, name, content):
    chore, kid = await _setup(db)
    with pytest.raises(HTTPException) as exc:
        await complete_chore(chore.id, _FakeUpload(name, content), db, kid)
    assert exc.value.status_code == 400
    assert list(upload_dir.iterdir()) == []


@pytest.mark.asyncio
async def test_get_upload_refuses_non_image_extensions(upload_dir):
    (upload_dir / "evil.html").write_bytes(b"<script>")
    (upload_dir / "ok.png").write_bytes(PNG)
    with pytest.raises(HTTPException) as exc:
        await get_upload("evil.html")
    assert exc.value.status_code == 404
    assert (await get_upload("ok.png")).path.endswith("ok.png")
