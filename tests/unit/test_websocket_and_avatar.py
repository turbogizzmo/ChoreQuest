"""Regression tests for the WebSocket manager and avatar_config write paths."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend import websocket_manager as wsm
from backend.models import (
    AvatarAcquiredVia, AvatarItem, AvatarItemRarity, AvatarUnlockMethod,
    UserAvatarItem, UserRole,
)
from backend.routers.auth import update_me
from backend.routers.avatar import AvatarConfig, save_avatar
from backend.schemas import UpdateProfileRequest

from tests.unit.conftest import make_user


class _FakeSocket:
    def __init__(self, *, fail=False, hang=False, on_send=None):
        self.sent = []
        self.fail = fail
        self.hang = hang
        self.on_send = on_send

    async def accept(self):
        pass

    async def send_text(self, data):
        if self.on_send:
            self.on_send()
        if self.hang:
            await asyncio.sleep(3600)
        if self.fail:
            raise RuntimeError("socket closed")
        self.sent.append(data)


# ---------------------------------------------------------------------------
# C3 — WebSocket manager
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_disconnect_during_send_does_not_raise():
    manager = wsm.WebSocketManager()
    other = _FakeSocket()
    # The first socket's send disconnects the user's other socket mid-fanout —
    # the old list-based manager raised KeyError/ValueError here.
    first = _FakeSocket(fail=True, on_send=lambda: manager.disconnect(other, 1))
    await manager.connect(first, 1)
    await manager.connect(other, 1)

    await manager.send_to_user(1, {"type": "ping"})

    assert 1 not in manager.active_connections


@pytest.mark.asyncio
async def test_stalled_socket_is_dropped_and_others_still_receive():
    manager = wsm.WebSocketManager()
    slow, healthy = _FakeSocket(hang=True), _FakeSocket()
    await manager.connect(slow, 1)
    await manager.connect(healthy, 2)

    with patch.object(wsm, "SEND_TIMEOUT_SECONDS", 0.05):
        await manager.broadcast({"type": "data_changed"})

    assert healthy.sent == ['{"type": "data_changed"}']
    assert 1 not in manager.active_connections
    assert 2 in manager.active_connections


# ---------------------------------------------------------------------------
# C7 — avatar_config can't be used to grant pet XP or unowned items
# ---------------------------------------------------------------------------

async def _shop_item(db, item_id="crown"):
    item = AvatarItem(
        category="hat", item_id=item_id, display_name="Royal Crown",
        rarity=AvatarItemRarity.epic, unlock_method=AvatarUnlockMethod.shop,
        unlock_value=500, is_default=False,
    )
    db.add(item)
    await db.flush()
    return item


@pytest.mark.asyncio
async def test_save_avatar_ignores_client_pet_xp(db):
    kid = await make_user(db, "avatar_kid")
    kid.avatar_config = {"pet": "cat", "pet_xp_map": {"cat": 5}, "pet_xp": 5}
    await db.commit()

    with patch("backend.routers.avatar.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await save_avatar(
            body=AvatarConfig(config={
                "pet": "cat", "pet_xp_map": {"cat": 99999}, "pet_xp": 99999,
                "pet_interactions": {"count": 0},
            }),
            db=db, user=kid,
        )

    config = result["avatar_config"]
    assert config["pet_xp_map"] == {"cat": 5}
    assert config["pet_xp"] == 5
    assert "pet_interactions" not in config


@pytest.mark.asyncio
async def test_save_avatar_rejects_unowned_shop_item_for_kid(db):
    kid = await make_user(db, "avatar_kid2")
    await _shop_item(db)
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await save_avatar(body=AvatarConfig(config={"hat": "crown"}), db=db, user=kid)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_save_avatar_allows_owned_shop_item(db):
    kid = await make_user(db, "avatar_kid3")
    item = await _shop_item(db)
    db.add(UserAvatarItem(user_id=kid.id, avatar_item_id=item.id,
                          acquired_via=AvatarAcquiredVia.purchase))
    await db.commit()

    with patch("backend.routers.avatar.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await save_avatar(body=AvatarConfig(config={"hat": "crown"}), db=db, user=kid)
    assert result["avatar_config"]["hat"] == "crown"


@pytest.mark.asyncio
async def test_save_avatar_parent_has_everything_unlocked(db):
    parent = await make_user(db, "avatar_parent", role=UserRole.parent)
    await _shop_item(db)
    await db.commit()

    with patch("backend.routers.avatar.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        result = await save_avatar(body=AvatarConfig(config={"hat": "crown"}), db=db, user=parent)
    assert result["avatar_config"]["hat"] == "crown"


@pytest.mark.asyncio
async def test_update_me_theme_merges_without_touching_pet_xp(db):
    kid = await make_user(db, "theme_kid")
    kid.avatar_config = {"pet": "cat", "pet_xp_map": {"cat": 42}}
    await db.commit()

    with patch("backend.routers.auth.ws_manager") as mock_ws:
        mock_ws.broadcast = AsyncMock()
        await update_me(body=UpdateProfileRequest(color_theme="dragon"), db=db, user=kid)

    assert kid.avatar_config == {"pet": "cat", "pet_xp_map": {"cat": 42}, "color_theme": "dragon"}


def test_update_profile_no_longer_accepts_raw_avatar_config():
    body = UpdateProfileRequest.model_validate({"avatar_config": {"pet_xp_map": {"cat": 1}}})
    assert not hasattr(body, "avatar_config")
