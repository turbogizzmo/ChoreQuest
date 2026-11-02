"""Self-registration never lets the client choose its own role.

With open registration on, a visitor used to be able to send
``"role": "admin"`` and get a full admin account.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select

from backend.models import InviteCode, User, UserRole
from backend.routers import auth as auth_router
from backend.schemas import RegisterRequest
from tests.unit.conftest import make_user


def _request(host: str):
    return SimpleNamespace(client=SimpleNamespace(host=host), cookies={})


async def _register(db, host: str, **body):
    body.setdefault("password", "secret123")
    body.setdefault("display_name", body["username"][:10])
    return await auth_router.register(RegisterRequest(**body), _request(host), Response(), db)


@pytest.mark.asyncio
@pytest.mark.parametrize("requested", ["admin", "parent"])
async def test_open_registration_ignores_requested_role(db, requested):
    await make_user(db, "Dad", UserRole.admin)
    await db.commit()

    with patch.object(auth_router.settings, "REGISTRATION_ENABLED", True):
        resp = await _register(db, f"10.0.0.{len(requested)}", username="intruder", role=requested)

    assert resp.user.role == UserRole.kid
    user = (await db.execute(select(User).where(User.username == "intruder"))).scalar_one()
    assert user.role == UserRole.kid


@pytest.mark.asyncio
async def test_invite_code_sets_role_even_with_open_registration(db):
    admin = await make_user(db, "Dad", UserRole.admin)
    db.add(InviteCode(code="PARENT01", role=UserRole.parent, created_by=admin.id, max_uses=1))
    await db.commit()

    with patch.object(auth_router.settings, "REGISTRATION_ENABLED", True):
        resp = await _register(db, "10.0.1.1", username="Mom", invite_code="PARENT01")

    assert resp.user.role == UserRole.parent


@pytest.mark.asyncio
async def test_closed_registration_still_requires_invite(db):
    await make_user(db, "Dad", UserRole.admin)
    await db.commit()

    with patch.object(auth_router.settings, "REGISTRATION_ENABLED", False):
        with pytest.raises(HTTPException) as exc:
            await _register(db, "10.0.2.1", username="intruder", role="admin")
    assert exc.value.status_code == 400
