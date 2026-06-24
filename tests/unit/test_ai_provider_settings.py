import pytest

from fastapi import HTTPException

from backend.models import AppSetting, UserRole
from backend.services.ai_provider import (
    AIProviderConfig,
    DEFAULT_MODELS,
    _map_ai_provider_error,
    ai_generation_available,
    coerce_generated_quest,
    get_ai_provider_config,
    get_ai_settings_payload,
    save_ai_settings,
)
from backend.services.secure_settings import decrypt_secret
from backend.schemas import AISettingsUpdate
from tests.unit.conftest import make_category, make_user


@pytest.fixture(autouse=True)
def _skip_live_validation(monkeypatch):
    """save_ai_settings now probes the live provider; no-op it by default so
    settings tests don't make network calls. Tests that exercise validation
    re-patch the probe functions explicitly."""
    async def _ok(config):
        return None

    monkeypatch.setattr("backend.services.ai_provider.validate_ai_config", _ok)


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
    assert config.model == DEFAULT_MODELS["gemini"]
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


def test_map_ai_provider_error_for_gemini_quota():
    error = _map_ai_provider_error(
        "gemini",
        RuntimeError("429 RESOURCE_EXHAUSTED quota exceeded"),
    )
    assert error.status_code == 503
    assert "quota exceeded" in error.detail.lower()


def test_map_ai_provider_error_for_gemini_retired_model():
    error = _map_ai_provider_error(
        "gemini",
        RuntimeError("404 NOT_FOUND model is no longer available"),
    )
    assert error.status_code == 503
    assert "no longer available" in error.detail.lower()


def test_map_ai_provider_error_for_unsupported_gemini_model():
    # The interactions API rejects unsupported model families (e.g. gemini-2.0)
    # with a 400; surface an actionable message instead of a generic 502.
    error = _map_ai_provider_error(
        "gemini",
        RuntimeError(
            "Error code: 400 - {'error': {'message': 'Model family "
            "gemini-2.0 is not supported.', 'code': 'invalid_request'}}"
        ),
    )
    assert error.status_code == 503
    assert "isn't supported" in error.detail
    assert "Family Settings" in error.detail


def test_default_gemini_model_is_a_supported_family():
    # gemini-2.0-* is rejected by the interactions API; the default must not be it.
    assert DEFAULT_MODELS["gemini"] == "gemini-flash-latest"
    assert not DEFAULT_MODELS["gemini"].startswith("gemini-2.0")


def test_default_anthropic_model_is_current():
    # claude-sonnet-4-5 is older; default should be a current model.
    assert DEFAULT_MODELS["anthropic"] == "claude-haiku-4-5"


@pytest.mark.asyncio
async def test_list_models_for_request_anthropic(db, monkeypatch):
    from backend.services import ai_provider
    from backend.schemas import AIModelListRequest

    captured = {}

    def fake_get_json(url, headers):
        captured["url"] = url
        captured["headers"] = headers
        return {
            "data": [
                {"id": "claude-haiku-4-5", "display_name": "Claude Haiku 4.5"},
                {"id": "claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6"},
            ]
        }

    monkeypatch.setattr(ai_provider, "_get_json", fake_get_json)

    models = await ai_provider.list_models_for_request(
        db,
        AIModelListRequest(provider="anthropic", anthropic_api_key="sk-ant-test"),
    )

    ids = [m["id"] for m in models]
    assert ids == ["claude-haiku-4-5", "claude-sonnet-4-6"]  # sorted by id
    assert models[0]["label"] == "Claude Haiku 4.5"
    assert captured["headers"]["x-api-key"] == "sk-ant-test"


@pytest.mark.asyncio
async def test_list_models_requires_a_key(db):
    from backend.services import ai_provider
    from backend.schemas import AIModelListRequest

    with pytest.raises(HTTPException) as exc_info:
        await ai_provider.list_models_for_request(
            db, AIModelListRequest(provider="openai")
        )
    assert exc_info.value.status_code == 400
    assert "API key" in exc_info.value.detail


@pytest.mark.asyncio
async def test_save_ai_settings_rejects_unvalidatable_model(db, monkeypatch):
    # Override the autouse no-op: make validation fail like an unsupported model.
    from backend.services import ai_provider

    async def _boom(config):
        raise ai_provider._map_ai_provider_error(
            "gemini", RuntimeError("400 Model family gemini-2.0 is not supported.")
        )

    monkeypatch.setattr(ai_provider, "validate_ai_config", _boom)

    with pytest.raises(HTTPException) as exc_info:
        await save_ai_settings(
            db,
            AISettingsUpdate(
                provider="gemini",
                model="gemini-2.0-flash",
                gemini_api_key="test-key",
            ),
        )
    assert exc_info.value.status_code == 503
    # Nothing should have been persisted (rolled back).
    assert await db.get(AppSetting, "ai_gemini_api_key") is None
    assert await db.get(AppSetting, "ai_provider") is None
