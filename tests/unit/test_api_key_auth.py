"""Unit tests for API key authentication in dependencies.py.

Tests cover the _auth_via_api_key helper directly so we can exercise
all branches (valid key, wrong key, revoked key, inactive owner) without
spinning up an HTTP server.
"""

import hashlib
import pytest
import pytest_asyncio
from datetime import datetime, timezone

from tests.unit.conftest import make_user
from backend.models import ApiKey, UserRole
from backend.dependencies import _auth_via_api_key
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _make_api_key(
    db,
    creator_id: int,
    raw_key: str = "test-raw-key-abc123",
    *,
    is_active: bool = True,
    name: str = "Test Key",
) -> ApiKey:
    key = ApiKey(
        name=name,
        key_hash=_hash(raw_key),
        key_prefix=raw_key[:8],
        scopes=[],
        created_by=creator_id,
        is_active=is_active,
        created_at=datetime.now(timezone.utc),
    )
    db.add(key)
    await db.flush()
    return key


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_api_key_returns_creator(db):
    """A valid, active API key authenticates as its creator."""
    admin = await make_user(db, "admin_user", role=UserRole.admin)
    raw = "valid-key-xyz-9876"
    await _make_api_key(db, creator_id=admin.id, raw_key=raw)

    user = await _auth_via_api_key(raw, db)

    assert user.id == admin.id
    assert user.username == "admin_user"


@pytest.mark.asyncio
async def test_valid_key_updates_last_used_at(db):
    """last_used_at is stamped when a valid key is used."""
    admin = await make_user(db, "admin2", role=UserRole.admin)
    raw = "stamp-test-key-111"
    key = await _make_api_key(db, creator_id=admin.id, raw_key=raw)
    assert key.last_used_at is None

    await _auth_via_api_key(raw, db)

    assert key.last_used_at is not None


@pytest.mark.asyncio
async def test_wrong_key_raises_401(db):
    """A key that does not exist in the database returns 401."""
    admin = await make_user(db, "admin3", role=UserRole.admin)
    await _make_api_key(db, creator_id=admin.id, raw_key="correct-key")

    with pytest.raises(HTTPException) as exc_info:
        await _auth_via_api_key("wrong-key-totally-different", db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_revoked_key_raises_401(db):
    """A key with is_active=False is rejected."""
    admin = await make_user(db, "admin4", role=UserRole.admin)
    raw = "revoked-key-abc"
    await _make_api_key(db, creator_id=admin.id, raw_key=raw, is_active=False)

    with pytest.raises(HTTPException) as exc_info:
        await _auth_via_api_key(raw, db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_inactive_owner_raises_401(db):
    """A valid key whose creator account is deactivated is rejected."""
    admin = await make_user(db, "admin5", role=UserRole.admin)
    admin.is_active = False
    await db.flush()

    raw = "orphan-key-xyz"
    await _make_api_key(db, creator_id=admin.id, raw_key=raw)

    with pytest.raises(HTTPException) as exc_info:
        await _auth_via_api_key(raw, db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_multiple_keys_for_same_user(db):
    """Multiple active keys for the same user all work independently."""
    admin = await make_user(db, "admin6", role=UserRole.admin)
    await _make_api_key(db, creator_id=admin.id, raw_key="key-one", name="Key One")
    await _make_api_key(db, creator_id=admin.id, raw_key="key-two", name="Key Two")

    user_one = await _auth_via_api_key("key-one", db)
    user_two = await _auth_via_api_key("key-two", db)

    assert user_one.id == admin.id
    assert user_two.id == admin.id


@pytest.mark.asyncio
async def test_key_hash_collision_resistance(db):
    """Two different raw keys do not resolve to the same user."""
    admin_a = await make_user(db, "admin_a", role=UserRole.admin)
    admin_b = await make_user(db, "admin_b", role=UserRole.admin)
    await _make_api_key(db, creator_id=admin_a.id, raw_key="key-for-admin-a")
    await _make_api_key(db, creator_id=admin_b.id, raw_key="key-for-admin-b")

    user_a = await _auth_via_api_key("key-for-admin-a", db)
    user_b = await _auth_via_api_key("key-for-admin-b", db)

    assert user_a.id == admin_a.id
    assert user_b.id == admin_b.id
    assert user_a.id != user_b.id
