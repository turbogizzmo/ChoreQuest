import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.config import settings
from backend.dependencies import get_current_user, require_parent
from backend.models import User

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = "/app/data/uploads"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MIME_TO_EXT = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/gif": {".gif"},
    "image/webp": {".webp"},
}
SERVABLE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def sniff_image_ext(contents: bytes) -> str | None:
    """Return the file extension for an allowed image type, judged by its
    magic bytes rather than the client's filename or Content-Type, or None."""
    if contents.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if contents.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if contents[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, GIF, WebP")

    max_size = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    contents = await file.read(max_size + 1)  # never pull more than the cap into memory
    if len(contents) > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Max {settings.MAX_UPLOAD_SIZE_MB}MB")

    ext = sniff_image_ext(contents)
    if ext is None:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, GIF, WebP")
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(contents)

    return {"path": f"/api/uploads/{filename}", "filename": filename}


@router.get("/{filename}")
async def get_upload(filename: str):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    # Only ever serve images, so a stray .html/.js/.svg can't run same-origin
    if os.path.splitext(safe_name)[1].lower() not in SERVABLE_EXTS or not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)


@router.delete("/{filename}")
async def delete_upload(
    filename: str,
    user: User = Depends(require_parent),
):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    os.remove(filepath)
    return {"detail": "Deleted"}
