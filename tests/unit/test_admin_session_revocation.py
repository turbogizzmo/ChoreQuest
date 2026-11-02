"""Admin password reset, deactivation and role change end the user's
sessions."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from backend.auth import create_refresh_token, hash_token
from backend.models import RefreshToken, UserRole
from backend.routers.admin import deactivate_user, reset_user_password, update_user
from backend.schemas import AdminResetPasswordRequest, AdminUserUpdate
from tests.unit.conftest import make_user


async def _setup(db):
    admin = await make_user(db, "Dad", UserRole.admin)
    kid = await make_user(db, "kiddo", UserRole.kid)
    raw, expires_at = create_refresh_token(kid.id)
    db.add(RefreshToken(user_id=kid.id, token_hash=hash_token(raw), expires_at=expires_at))
    await db.commit()
    return admin, kid


async def _revoked(db, user_id):
    rows = (await db.execute(select(RefreshToken).where(RefreshToken.user_id == user_id))).scalars().all()
    return all(r.is_revoked for r in rows)


@pytest.mark.asyncio
async def test_reset_password_revokes_sessions(db):
    admin, kid = await _setup(db)
    with patch("backend.routers.admin.ws_manager") as ws:
        ws.close_user = AsyncMock()
        await reset_user_password(kid.id, AdminResetPasswordRequest(new_password="newpass999"), db, admin)
    assert await _revoked(db, kid.id)
    ws.close_user.assert_awaited_once_with(kid.id)


@pytest.mark.asyncio
async def test_deactivate_revokes_sessions(db):
    admin, kid = await _setup(db)
    with patch("backend.routers.admin.ws_manager") as ws:
        ws.close_user = AsyncMock()
        await deactivate_user(kid.id, db, admin)
    assert await _revoked(db, kid.id)
    ws.close_user.assert_awaited_once_with(kid.id)


@pytest.mark.asyncio
async def test_role_change_revokes_but_noop_update_does_not(db):
    admin, kid = await _setup(db)
    with patch("backend.routers.admin.ws_manager") as ws:
        ws.close_user = AsyncMock()
        await update_user(kid.id, AdminUserUpdate(role=UserRole.kid, is_active=True), db, admin)
        assert not await _revoked(db, kid.id)
        await update_user(kid.id, AdminUserUpdate(role=UserRole.parent), db, admin)
    assert await _revoked(db, kid.id)
