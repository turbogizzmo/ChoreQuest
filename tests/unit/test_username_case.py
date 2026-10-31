"""Usernames match case-insensitively at login (phones often capitalise the
first letter), and registration rejects names differing only by case."""

import pytest

from backend.models import UserRole
from backend.routers.auth import find_user_by_username
from tests.unit.conftest import make_user


@pytest.mark.asyncio
@pytest.mark.parametrize("typed", ["Dad", "dad", "DAD", "dAd"])
async def test_login_lookup_ignores_case(db, typed):
    dad = await make_user(db, "Dad", UserRole.admin)
    await make_user(db, "Mom", UserRole.parent)
    await db.commit()

    found = await find_user_by_username(db, typed)
    assert found is not None and found.id == dad.id


@pytest.mark.asyncio
async def test_unknown_username_returns_none(db):
    await make_user(db, "Dad", UserRole.admin)
    await db.commit()

    assert await find_user_by_username(db, "dadd") is None


@pytest.mark.asyncio
async def test_exact_match_wins_when_names_differ_only_by_case(db):
    # Accounts created before registration checked case can collide
    upper = await make_user(db, "Kid", UserRole.kid)
    lower = await make_user(db, "kid", UserRole.kid)
    await db.commit()

    assert (await find_user_by_username(db, "Kid")).id == upper.id
    assert (await find_user_by_username(db, "kid")).id == lower.id
    # Ambiguous: neither spelling matches exactly, so don't guess
    assert await find_user_by_username(db, "KID") is None
