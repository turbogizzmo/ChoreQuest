import pytest

from fastapi import HTTPException

from backend.models import AppSetting, UserRole
from backend.services.ai_provider import (
    AIProviderConfig,
    ai_generation_available,
    coerce_generated_quest,
    get_ai_provider_config,
    get_ai_settings_payload,
    save_ai_settings,
)
from backend.services.secure_settings import decrypt_secret
from backend.schemas import AISettingsUpdate
from tests.unit.conftest import make_category, make_user


@pytest.mark.asyncio
async def test_ai_settings_save_encrypts_secret_and_masks_response(db):
    await make_user(db, "settings_parent1", role=UserRole.parent)

    payload = await save_ai_settings(
        db,
        AISettingsUpdate(
            provider="openai",
            model="gpt-5.5-mini",
            openai_api_key="sk-test-123",
            openai_organization="org_123",
            openai_project="proj_123",
        ),
    )

    stored = await db.get(AppSetting, "ai_openai_api_key")
    assert stored is not None
    assert stored.value != "sk-test-123"
    assert decrypt_secret(stored.value) == "sk-test-123"
    assert payload["providers"]["openai"]["configured"] is True
    assert "openai_api_key" not in payload


@pytest.mark.asyncio
async def test_ai_settings_loads_env_override_for_gemini(db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "env-gemini-key")

    config = await get_ai_provider_config(db)

    assert config.provider == "gemini"
    assert config.gemini_api_key == "env-gemini-key"
    assert config.is_configured is True


@pytest.mark.asyncio
async def test_ai_generation_available_reflects_selected_provider(db):
    assert await ai_generation_available(db) is False

    await save_ai_settings(
        db,
        AISettingsUpdate(
            provider="ollama",
            model="llama3.1",
            ollama_base_url="http://127.0.0.1:11434",
        ),
    )

    assert await ai_generation_available(db) is True


@pytest.mark.asyncio
async def test_save_ai_settings_can_clear_secret(db):
    await save_ai_settings(
        db,
        AISettingsUpdate(
            provider="anthropic",
            model="claude-sonnet-4-5",
            anthropic_api_key="secret-key",
        ),
    )

    payload = await save_ai_settings(
        db,
        AISettingsUpdate(
            provider="anthropic",
            model="claude-sonnet-4-5",
            clear_anthropic_api_key=True,
        ),
    )

    assert await db.get(AppSetting, "ai_anthropic_api_key") is None
    assert payload["providers"]["anthropic"]["configured"] is False


@pytest.mark.asyncio
async def test_coerce_generated_quest_caps_points_and_defaults_category(db):
    category = await make_category(db, "Kitchen")

    data = coerce_generated_quest(
        {
            "title": "Pantry Patrol",
            "description": "Organize the shelf.",
            "points": 999,
            "difficulty": "medium",
            "category_name": "Unknown",
        },
        [category],
    )

    assert data["points"] == 50
    assert data["category_id"] == category.id
    assert data["category_name"] == "Kitchen"


@pytest.mark.asyncio
async def test_coerce_generated_quest_requires_non_empty_title(db):
    with pytest.raises(HTTPException) as exc_info:
        coerce_generated_quest(
            {
                "title": "",
                "description": "desc",
                "points": 10,
                "difficulty": "easy",
                "category_name": "",
            },
            [],
        )

    assert exc_info.value.status_code == 502
