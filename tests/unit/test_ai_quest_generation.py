import json
import sys
import types

import pytest
from fastapi import HTTPException

from backend.models import Difficulty, UserRole
from backend.rate_limit import rate_limiter
from backend.routers.chores import generate_quest
from backend.schemas import QuestGenerateRequest
from tests.unit.conftest import make_category, make_chore, make_user


def _install_fake_google(monkeypatch, response_payload, captured):
    class FakeGenerateContentConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeModels:
        async def generate_content(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config
            return types.SimpleNamespace(text=json.dumps(response_payload))

    class FakeClient:
        def __init__(self, api_key):
            captured["api_key"] = api_key
            self.aio = types.SimpleNamespace(models=FakeModels())

    google_module = types.ModuleType("google")
    genai_module = types.ModuleType("google.genai")
    genai_module.Client = FakeClient
    genai_module.types = types.SimpleNamespace(
        GenerateContentConfig=FakeGenerateContentConfig
    )
    google_module.genai = genai_module

    monkeypatch.setitem(sys.modules, "google", google_module)
    monkeypatch.setitem(sys.modules, "google.genai", genai_module)


@pytest.mark.asyncio
async def test_generate_quest_does_not_send_existing_family_chores(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "parent_ai", role=UserRole.parent)
    category = await make_category(db, "Kitchen")
    private_title = "Clean Ava's inhaler station"
    private_description = "Wipe the medicine tray beside Ava's bed."
    chore = await make_chore(
        db,
        creator_id=parent.id,
        category_id=category.id,
        title=private_title,
    )
    chore.description = private_description
    await db.flush()

    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Cupboard Crusade",
            "description": "Restore order to the snack shelf.",
            "points": 20,
            "difficulty": "medium",
            "category_name": "Kitchen",
        },
        captured,
    )

    response = await generate_quest(
        QuestGenerateRequest(prompt="organize the snack shelf"),
        db=db,
        user=parent,
    )

    assert response.title == "Cupboard Crusade"
    assert private_title not in captured["contents"]
    assert private_description not in captured["contents"]
    assert "The Chamber of Rest" in captured["contents"]


@pytest.mark.asyncio
async def test_generate_quest_caps_ai_points_to_safe_max(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "parent_cap", role=UserRole.parent)
    await make_category(db, "General")

    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Dragon Hoard Sort",
            "description": "Sort the toy bin.",
            "points": 9999,
            "difficulty": "expert",
            "category_name": "General",
        },
        captured,
    )

    response = await generate_quest(
        QuestGenerateRequest(prompt="sort the toy bin"),
        db=db,
        user=parent,
    )

    assert response.points == 50
    assert response.difficulty == Difficulty.expert


@pytest.mark.asyncio
async def test_generate_quest_rate_limits_per_parent(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "parent_limit", role=UserRole.parent)
    await make_category(db, "General")

    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Lantern Patrol",
            "description": "Put away the hallway clutter.",
            "points": 10,
            "difficulty": "easy",
            "category_name": "General",
        },
        captured,
    )

    for _ in range(5):
        await generate_quest(
            QuestGenerateRequest(prompt="put away hallway clutter"),
            db=db,
            user=parent,
        )

    with pytest.raises(HTTPException) as exc_info:
        await generate_quest(
            QuestGenerateRequest(prompt="put away hallway clutter"),
            db=db,
            user=parent,
        )

    assert exc_info.value.status_code == 429
