"""Refresh-token issuance and rotation.

Covers two bugs:
  * tokens issued in the same second were byte-identical, producing duplicate
    token_hash rows and a 500 (MultipleResultsFound) on later refreshes;
  * the losing side of two concurrent refreshes cleared the winner's new
    refresh cookie, logging the user out.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import Response
from fastapi.responses import JSONResponse
from sqlalchemy import select

from backend.auth import create_access_token, create_refresh_token, hash_token
from backend.models import RefreshToken, UserRole
from backend.routers.auth import REFRESH_COOKIE_NAME, refresh
from tests.unit.conftest import make_user


def _request(cookie: str):
    return SimpleNamespace(cookies={REFRESH_COOKIE_NAME: cookie})


def _set_cookie_headers(resp: Response) -> list[str]:
    return [v.decode() for k, v in resp.raw_headers if k.lower() == b"set-cookie"]


def _new_cookie(resp: Response) -> str:
    for header in _set_cookie_headers(resp):
        name, _, rest = header.partition("=")
        if name == REFRESH_COOKIE_NAME:
            return rest.split(";", 1)[0]
    raise AssertionError("no refresh cookie set")


def _clears_cookie(resp: Response) -> bool:
    return any(
        h.startswith(f"{REFRESH_COOKIE_NAME}=") and ("Max-Age=0" in h or '=""' in h)
        for h in _set_cookie_headers(resp)
    )


async def _store(db, user_id: int) -> str:
    raw, expires_at = create_refresh_token(user_id)
    db.add(RefreshToken(user_id=user_id, token_hash=hash_token(raw), expires_at=expires_at))
    await db.commit()
    return raw


# ---------------------------------------------------------------------------
# Same-second issuance
# ---------------------------------------------------------------------------

def test_tokens_issued_in_same_second_are_distinct():
    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    with patch("backend.auth.datetime", _Frozen):
        r1, _ = create_refresh_token(1)
        r2, _ = create_refresh_token(1)
        a1 = create_access_token(1, "kid")
        a2 = create_access_token(1, "kid")
    assert hash_token(r1) != hash_token(r2)
    assert a1 != a2


@pytest.mark.asyncio
async def test_refresh_works_after_same_second_logins(db):
    user = await make_user(db, "kiddo", UserRole.kid)
    await db.commit()
    first = await _store(db, user.id)
    await _store(db, user.id)  # second login in the same second

    result = await refresh(_request(first), Response(), db)
    assert not isinstance(result, JSONResponse)
    assert result.access_token


# ---------------------------------------------------------------------------
# Concurrent / repeated refresh with a just-rotated token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_second_refresh_with_just_rotated_token_keeps_session(db):
    user = await make_user(db, "kiddo", UserRole.kid)
    await db.commit()
    old = await _store(db, user.id)

    winner = Response()
    await refresh(_request(old), winner, db)
    winner_cookie = _new_cookie(winner)

    # Loser arrives with the same (now rotated) cookie.
    loser = Response()
    result = await refresh(_request(old), loser, db)

    assert not isinstance(result, JSONResponse), "loser must not get a 401"
    assert not _clears_cookie(loser)
    loser_cookie = _new_cookie(loser)

    # Whichever Set-Cookie lands last, the browser ends up with a usable token.
    for cookie in (winner_cookie, loser_cookie):
        r = await refresh(_request(cookie), Response(), db)
        assert not isinstance(r, JSONResponse)


@pytest.mark.asyncio
async def test_rotated_token_outside_grace_is_rejected(db):
    user = await make_user(db, "kiddo", UserRole.kid)
    await db.commit()
    old = await _store(db, user.id)
    await refresh(_request(old), Response(), db)

    stored = (await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(old))
    )).scalar_one()
    stored.rotated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    await db.commit()

    result = await refresh(_request(old), Response(), db)
    assert isinstance(result, JSONResponse)
    assert result.status_code == 401
    assert _clears_cookie(result)


@pytest.mark.asyncio
async def test_rotated_token_rejected_once_successor_revoked(db):
    """Logging out (revoking the successor) closes the grace window."""
    user = await make_user(db, "kiddo", UserRole.kid)
    await db.commit()
    old = await _store(db, user.id)
    winner = Response()
    await refresh(_request(old), winner, db)

    successor = (await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(_new_cookie(winner)))
    )).scalar_one()
    successor.is_revoked = True
    await db.commit()

    result = await refresh(_request(old), Response(), db)
    assert isinstance(result, JSONResponse)
    assert result.status_code == 401


@pytest.mark.asyncio
async def test_logged_out_token_is_rejected(db):
    user = await make_user(db, "kiddo", UserRole.kid)
    await db.commit()
    raw = await _store(db, user.id)
    stored = (await db.execute(select(RefreshToken))).scalar_one()
    stored.is_revoked = True  # logout: no rotated_at
    await db.commit()

    result = await refresh(_request(raw), Response(), db)
    assert isinstance(result, JSONResponse)
    assert result.status_code == 401
