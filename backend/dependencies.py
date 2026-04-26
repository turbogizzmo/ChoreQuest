import hashlib
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.auth import decode_access_token
from backend.models import ApiKey, User, UserRole


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """Authenticate via JWT Bearer token or X-API-Key header.

    Checks X-API-Key first (faster for automation), then falls back to
    the standard Authorization: Bearer <jwt> flow used by the web app.
    """
    api_key_header = request.headers.get("X-API-Key")
    if api_key_header:
        return await _auth_via_api_key(api_key_header, db)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header.split(" ", 1)[1]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def _auth_via_api_key(raw_key: str, db: AsyncSession) -> User:
    """Validate an API key and return the admin user who owns it.

    The raw key is never stored — only its SHA-256 hash is kept in the
    database.  A valid, active key authenticates as its creator, giving
    the same access level as that user (always admin by design).
    """
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")

    # Stamp last_used_at — intentionally not awaited with a separate commit
    # so the update is batched with whatever the request handler commits next.
    api_key.last_used_at = datetime.now(timezone.utc)

    user_result = await db.execute(
        select(User).where(User.id == api_key.created_by, User.is_active == True)
    )
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="API key owner not found or inactive")
    return user


async def require_parent(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.parent, UserRole.admin):
        raise HTTPException(status_code=403, detail="Parent or admin role required")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


async def require_kid(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.kid:
        raise HTTPException(status_code=403, detail="Kid role required")
    return user
