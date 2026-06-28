import json
import sys
import types

import pytest
from fastapi import HTTPException

from backend.models import UserRole
from backend.rate_limit import rate_limiter
from backend.routers.rewards import generate_reward
from backend.schemas import RewardGenerateRequest

from tests.unit.conftest import make_user


def _install_fake_google(monkeypatch, response_payload, captured):
    class FakeInteractions:
        async def create(
            self,
            *,
            model,
            input,
            system_instruction,
            response_format,
            generation_config,
        ):
            captured["model"] = model
            captured["contents"] = input
            captured["system_instruction"] = system_instruction
            captured["response_format"] = response_format
            captured["generation_config"] = generation_config
            return types.SimpleNamespace(output_text=json.dumps(response_payload))

    class FakeClient:
        def __init__(self, api_key):
            captured["api_key"] = api_key
            self.aio = types.SimpleNamespace(interactions=FakeInteractions())

    google_module = types.ModuleType("google")
    genai_module = types.ModuleType("google.genai")
    genai_module.Client = FakeClient
    google_module.genai = genai_module

    monkeypatch.setitem(sys.modules, "google", google_module)
    monkeypatch.setitem(sys.modules, "google.genai", genai_module)


@pytest.mark.asyncio
async def test_generate_reward_uses_reward_style_examples_and_cost_guidance(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "reward_parent", role=UserRole.parent)
    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Lego Wolf Rescue",
            "description": "Claim a small Lego wolf set for your next building night.",
            "point_cost": 180,
            "category": "Toys",
            "icon": "🧱",
            "cost_basis": "Estimated around $18 retail, converted at about 10 XP per dollar.",
        },
        captured,
    )

    response = await generate_reward(
        RewardGenerateRequest(prompt="Lego Minecraft wolf set from a kid wish list, around $18"),
        db=db,
        current_user=parent,
    )

    assert response.title == "Lego Wolf Rescue"
    assert response.point_cost == 180
    assert "Extra Screen Time" in captured["contents"]
    assert "10 XP per US dollar" in captured["system_instruction"]
    assert captured["response_format"]["schema"]["required"] == [
        "title",
        "description",
        "point_cost",
        "category",
        "icon",
        "cost_basis",
    ]


@pytest.mark.asyncio
async def test_generate_reward_caps_ai_point_cost(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "reward_cap", role=UserRole.parent)
    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Mega Gaming Chair",
            "description": "Claim the chair of legends.",
            "point_cost": 999999,
            "category": "Gear",
            "icon": "🪑",
            "cost_basis": "Estimated premium chair price.",
        },
        captured,
    )

    response = await generate_reward(
        RewardGenerateRequest(prompt="premium gaming chair"),
        db=db,
        current_user=parent,
    )

    assert response.point_cost == 5000


@pytest.mark.asyncio
async def test_generate_reward_rate_limits_per_parent(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    rate_limiter._windows.clear()

    parent = await make_user(db, "reward_limit", role=UserRole.parent)
    captured = {}
    _install_fake_google(
        monkeypatch,
        {
            "title": "Dessert Decree",
            "description": "Choose dessert for a family meal.",
            "point_cost": 75,
            "category": "Experiences",
            "icon": "🍨",
            "cost_basis": "Non-monetary family treat.",
        },
        captured,
    )

    for _ in range(5):
        await generate_reward(
            RewardGenerateRequest(prompt="pick dessert for dinner"),
            db=db,
            current_user=parent,
        )

    with pytest.raises(HTTPException) as exc_info:
        await generate_reward(
            RewardGenerateRequest(prompt="pick dessert for dinner"),
            db=db,
            current_user=parent,
        )

    assert exc_info.value.status_code == 429
