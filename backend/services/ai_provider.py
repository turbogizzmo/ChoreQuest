import asyncio
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AppSetting, ChoreCategory, Difficulty
from backend.rate_limit import rate_limiter
from backend.services.secure_settings import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "gemini"
DEFAULT_MODELS = {
    "gemini": "gemini-flash-latest",
    "openai": "gpt-5.5-mini",
    "anthropic": "claude-haiku-4-5",
    "ollama": "gemma3",
}
SUPPORTED_AI_PROVIDERS = tuple(DEFAULT_MODELS.keys())
AI_QUEST_RATE_LIMIT_MAX_REQUESTS = 5
AI_QUEST_RATE_LIMIT_WINDOW_SECONDS = 300
AI_QUEST_MAX_POINTS = 50
AI_REWARD_MAX_POINT_COST = 5000
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"

_SETTING_DEFAULTS = {
    "ai_provider": DEFAULT_PROVIDER,
    "ai_model": DEFAULT_MODELS[DEFAULT_PROVIDER],
    "ai_openai_organization": "",
    "ai_openai_project": "",
    "ai_ollama_base_url": DEFAULT_OLLAMA_BASE_URL,
}
_SECRET_SETTING_KEYS = {
    "gemini_api_key": "ai_gemini_api_key",
    "openai_api_key": "ai_openai_api_key",
    "anthropic_api_key": "ai_anthropic_api_key",
}
_SECRET_ENV_KEYS = {
    "gemini_api_key": "GEMINI_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
}
_PROVIDER_REQUIRED_SECRET_FIELD = {
    "gemini": "gemini_api_key",
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "ollama": None,
}
_SEED_STYLE_EXAMPLES = [
    (
        "The Chamber of Rest",
        "Venture into your sleeping quarters and restore order to the land. "
        "Make the bed, clear the floor, and banish the chaos that lurks within.",
    ),
    (
        "Dishwasher's Oath",
        "The enchanted basin overflows with relics of past feasts. Empty its "
        "contents and return each vessel to its rightful place in the kingdom's cupboards.",
    ),
    (
        "Beast Keeper's Round",
        "The loyal creatures of the realm hunger for sustenance and care. Fill "
        "their bowls, refresh their water, and tend to their domain.",
    ),
]
_REWARD_STYLE_EXAMPLES = [
    (
        "Extra Screen Time",
        "Unlock 30 extra minutes of screen time after dinner for your next free evening.",
        50,
        "Treats",
    ),
    (
        "Pick Dessert",
        "Choose the dessert for one family meal this week and claim first pick when it is served.",
        75,
        "Experiences",
    ),
    (
        "Lego Surprise Pack",
        "Claim a small surprise Lego set or minifigure pack to add to your collection.",
        180,
        "Toys",
    ),
]


@dataclass
class AIProviderConfig:
    provider: str
    model: str
    gemini_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    openai_organization: str = ""
    openai_project: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL

    @property
    def required_secret_field(self) -> str | None:
        return _PROVIDER_REQUIRED_SECRET_FIELD.get(self.provider)

    @property
    def is_configured(self) -> bool:
        if self.provider == "ollama":
            return bool((self.ollama_base_url or "").strip() and self.model.strip())
        secret_field = self.required_secret_field
        if not secret_field:
            return False
        return bool(getattr(self, secret_field, "").strip() and self.model.strip())


def _default_model_for(provider: str) -> str:
    return DEFAULT_MODELS.get(provider, DEFAULT_MODELS[DEFAULT_PROVIDER])


def _validate_ollama_base_url(url: str) -> str:
    """Validate and normalise the Ollama base URL.

    Rejects anything that is not a plain http/https host[:port] to prevent
    SSRF via embedded paths, credentials, or non-HTTP schemes.
    """
    url = url.strip()
    if not url:
        return DEFAULT_OLLAMA_BASE_URL
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="Ollama base URL must use http or https",
        )
    if not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail="Ollama base URL must include a hostname",
        )
    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=400,
            detail="Ollama base URL must not include credentials",
        )
    if parsed.path and parsed.path.strip("/"):
        raise HTTPException(
            status_code=400,
            detail="Ollama base URL must not include a path",
        )
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def _build_ai_example_block() -> str:
    return "\n\n".join(
        f"Title: {title}\nDescription: {desc}"
        for title, desc in _SEED_STYLE_EXAMPLES
    )


def _build_reward_example_block() -> str:
    return "\n\n".join(
        "Title: {title}\nDescription: {desc}\nPoint Cost: {point_cost}\nCategory: {category}".format(
            title=title,
            desc=desc,
            point_cost=point_cost,
            category=category,
        )
        for title, desc, point_cost, category in _REWARD_STYLE_EXAMPLES
    )


def _quest_response_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "points": {"type": "integer"},
            "difficulty": {
                "type": "string",
                "enum": [d.value for d in Difficulty],
            },
            "category_name": {"type": "string"},
        },
        "required": ["title", "description", "points", "difficulty", "category_name"],
    }


def _reward_response_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "point_cost": {"type": "integer"},
            "category": {"type": "string"},
            "icon": {"type": "string"},
            "cost_basis": {"type": "string"},
        },
        "required": [
            "title",
            "description",
            "point_cost",
            "category",
            "icon",
            "cost_basis",
        ],
    }


async def _load_settings_map(db: AsyncSession) -> dict[str, str]:
    keys = list(_SETTING_DEFAULTS.keys()) + list(_SECRET_SETTING_KEYS.values())
    result = await db.execute(select(AppSetting).where(AppSetting.key.in_(keys)))
    return {row.key: row.value for row in result.scalars().all()}


def _decrypt_optional_secret(raw_value: str | None) -> str:
    if not raw_value:
        return ""
    try:
        return decrypt_secret(raw_value)
    except ValueError:
        logger.exception("Failed to decrypt stored AI provider secret")
        return ""


async def get_ai_provider_config(db: AsyncSession) -> AIProviderConfig:
    stored = await _load_settings_map(db)
    secret_values = {
        public_key: (
            os.environ.get(env_key)
            or _decrypt_optional_secret(stored.get(setting_key))
        )
        for public_key, setting_key in _SECRET_SETTING_KEYS.items()
        for env_key in [_SECRET_ENV_KEYS[public_key]]
    }
    provider = stored.get("ai_provider", _SETTING_DEFAULTS["ai_provider"]).strip() or DEFAULT_PROVIDER
    if provider not in SUPPORTED_AI_PROVIDERS:
        provider = DEFAULT_PROVIDER
    model = stored.get("ai_model", "").strip() or _default_model_for(provider)
    return AIProviderConfig(
        provider=provider,
        model=model,
        gemini_api_key=secret_values["gemini_api_key"],
        openai_api_key=secret_values["openai_api_key"],
        anthropic_api_key=secret_values["anthropic_api_key"],
        openai_organization=stored.get("ai_openai_organization", "").strip(),
        openai_project=stored.get("ai_openai_project", "").strip(),
        ollama_base_url=(
            os.environ.get("OLLAMA_BASE_URL")
            or stored.get("ai_ollama_base_url", DEFAULT_OLLAMA_BASE_URL).strip()
            or DEFAULT_OLLAMA_BASE_URL
        ),
    )


async def ai_generation_available(db: AsyncSession) -> bool:
    config = await get_ai_provider_config(db)
    return config.is_configured


async def get_ai_settings_payload(db: AsyncSession) -> dict:
    config = await get_ai_provider_config(db)
    stored = await _load_settings_map(db)

    def has_saved_secret(secret_field: str) -> bool:
        """Check configured status using the already-decrypted config value.

        This avoids a false positive when the raw DB token exists but
        decryption fails (in which case get_ai_provider_config returns "").
        """
        return bool(getattr(config, secret_field, "").strip())

    provider_states = {}
    for provider in SUPPORTED_AI_PROVIDERS:
        provider_states[provider] = {
            "configured": (
                provider == "ollama"
                and bool(config.ollama_base_url.strip())
            ) or (
                _PROVIDER_REQUIRED_SECRET_FIELD[provider] is not None
                and has_saved_secret(
                    _PROVIDER_REQUIRED_SECRET_FIELD[provider],
                )
            ),
            "default_model": _default_model_for(provider),
        }

    return {
        "provider": config.provider,
        "model": config.model,
        "openai_organization": config.openai_organization,
        "openai_project": config.openai_project,
        "ollama_base_url": config.ollama_base_url,
        "providers": provider_states,
        "active_provider_configured": config.is_configured,
    }


async def save_ai_settings(db: AsyncSession, body) -> dict:
    provider = body.provider.strip().lower()
    if provider not in SUPPORTED_AI_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")

    values_to_write = {
        "ai_provider": provider,
        "ai_model": body.model.strip() or _default_model_for(provider),
        "ai_openai_organization": (body.openai_organization or "").strip(),
        "ai_openai_project": (body.openai_project or "").strip(),
        "ai_ollama_base_url": _validate_ollama_base_url(body.ollama_base_url or DEFAULT_OLLAMA_BASE_URL),
    }

    for key, value in values_to_write.items():
        result = await db.execute(select(AppSetting).where(AppSetting.key == key))
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = value
        else:
            db.add(AppSetting(key=key, value=value))

    secret_updates = {
        "gemini_api_key": body.gemini_api_key,
        "openai_api_key": body.openai_api_key,
        "anthropic_api_key": body.anthropic_api_key,
    }
    secret_clears = {
        "gemini_api_key": body.clear_gemini_api_key,
        "openai_api_key": body.clear_openai_api_key,
        "anthropic_api_key": body.clear_anthropic_api_key,
    }

    for public_key, setting_key in _SECRET_SETTING_KEYS.items():
        result = await db.execute(select(AppSetting).where(AppSetting.key == setting_key))
        existing = result.scalar_one_or_none()
        if secret_clears[public_key]:
            if existing:
                await db.delete(existing)
            continue
        secret_value = (secret_updates[public_key] or "").strip()
        if not secret_value:
            continue
        encrypted = encrypt_secret(secret_value)
        if existing:
            existing.value = encrypted
        else:
            db.add(AppSetting(key=setting_key, value=encrypted))

    # Validate the resulting config against the live provider before persisting,
    # so a model/key that won't work is rejected with an actionable message
    # rather than silently saved and failing at generation time.
    await db.flush()
    config = await get_ai_provider_config(db)
    try:
        await validate_ai_config(config)
    except HTTPException:
        await db.rollback()
        raise

    await db.commit()
    return await get_ai_settings_payload(db)


def check_ai_generation_rate_limit(user_id: int):
    rate_limiter.check(
        key=f"ai-quest-generate:{user_id}",
        max_requests=AI_QUEST_RATE_LIMIT_MAX_REQUESTS,
        window_seconds=AI_QUEST_RATE_LIMIT_WINDOW_SECONDS,
    )


async def generate_quest_draft(
    *,
    prompt: str,
    categories: list[ChoreCategory],
    config: AIProviderConfig,
) -> dict:
    if not config.is_configured:
        raise HTTPException(
            status_code=503,
            detail="AI quest generation is not configured.",
        )

    category_names = [c.name for c in categories]
    category_block = ", ".join(category_names) if category_names else "General"
    system_instruction = (
        "You are a quest writer for a family chore app that frames chores as "
        "epic RPG/fantasy quests. Rewrite the parent's plain chore idea as a "
        "single quest that matches the voice, tone, and style of the examples: "
        "a short evocative fantasy title and a 1-2 sentence description that "
        "renames ordinary household items and actions in medieval/fantasy terms "
        "while keeping the real task clear. Pick the single best-fit category "
        f"from this list (use the exact name): {category_block}. Suggest an XP "
        "reward as a positive integer (easy chores ~10-15, medium ~20-25, hard "
        "~30) and a difficulty of easy, medium, hard, or expert. Respond with "
        "JSON only using keys title, description, points, difficulty, and category_name."
    )
    contents = (
        f"Examples of the desired style:\n\n{_build_ai_example_block()}\n\n"
        f"Parent's chore idea: {prompt}"
    )

    try:
        if config.provider == "gemini":
            data = await _generate_with_gemini(config, system_instruction, contents)
        elif config.provider == "openai":
            data = await asyncio.to_thread(
                _generate_with_openai, config, system_instruction, contents
            )
        elif config.provider == "anthropic":
            data = await asyncio.to_thread(
                _generate_with_anthropic, config, system_instruction, contents
            )
        elif config.provider == "ollama":
            data = await asyncio.to_thread(
                _generate_with_ollama, config, system_instruction, contents
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported AI provider")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("AI quest generation failed for provider %s", config.provider)
        raise _map_ai_provider_error(config.provider, exc)

    return coerce_generated_quest(data, categories)


async def generate_reward_draft(
    *,
    prompt: str,
    config: AIProviderConfig,
) -> dict:
    if not config.is_configured:
        raise HTTPException(
            status_code=503,
            detail="AI reward generation is not configured.",
        )

    system_instruction = (
        "You help parents turn kid reward ideas into polished, family-friendly "
        "reward drafts for a chore app. Match the examples' writing style: a "
        "short inviting title and a clear 1-2 sentence description. If the idea "
        "looks like a real-world item or paid experience, estimate a reasonable "
        "current USD cost from general market knowledge, then convert that to a "
        "point_cost using roughly 10 XP per US dollar and round to a tidy whole "
        "number. If the reward is non-monetary, suggest a fair point_cost based "
        "on desirability, exclusivity, and how often it can be redeemed. Suggest "
        "a short category label and a single emoji icon. Respond with JSON only "
        "using keys title, description, point_cost, category, icon, and cost_basis."
    )
    contents = (
        f"Examples of the desired style:\n\n{_build_reward_example_block()}\n\n"
        "Parent notes: this may include a kid's wishlist submission, notes, "
        f"or product details.\n\nReward idea: {prompt}"
    )

    try:
        if config.provider == "gemini":
            data = await _generate_with_gemini(
                config,
                system_instruction,
                contents,
                response_schema=_reward_response_schema(),
            )
        elif config.provider == "openai":
            data = await asyncio.to_thread(
                _generate_with_openai,
                config,
                system_instruction,
                contents,
            )
        elif config.provider == "anthropic":
            data = await asyncio.to_thread(
                _generate_with_anthropic,
                config,
                system_instruction,
                contents,
            )
        elif config.provider == "ollama":
            data = await asyncio.to_thread(
                _generate_with_ollama,
                config,
                system_instruction,
                contents,
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported AI provider")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("AI reward generation failed for provider %s", config.provider)
        raise _map_ai_provider_error(config.provider, exc)

    return coerce_generated_reward(data)


def coerce_generated_quest(data: dict, categories: list[ChoreCategory]) -> dict:
    title = str(data.get("title") or "").strip()[:200]
    description = str(data.get("description") or "").strip() or None
    if not title:
        raise HTTPException(status_code=502, detail="The oracle returned an empty quest.")

    try:
        points = int(data.get("points") or 10)
    except (TypeError, ValueError):
        points = 10
    points = min(AI_QUEST_MAX_POINTS, max(1, points))

    raw_difficulty = str(data.get("difficulty") or "").lower()
    try:
        difficulty = Difficulty(raw_difficulty)
    except ValueError:
        difficulty = Difficulty.easy

    category_name = str(data.get("category_name") or "").strip()
    category_id = next(
        (c.id for c in categories if c.name.lower() == category_name.lower()),
        None,
    )
    if category_id is None and categories:
        category_id = categories[0].id
        category_name = categories[0].name

    return {
        "title": title,
        "description": description,
        "points": points,
        "difficulty": difficulty,
        "category_name": category_name,
        "category_id": category_id,
    }


def coerce_generated_reward(data: dict) -> dict:
    title = str(data.get("title") or "").strip()[:200]
    description = str(data.get("description") or "").strip() or None
    category = str(data.get("category") or "").strip()[:50] or None
    icon = str(data.get("icon") or "").strip()[:50] or None
    cost_basis = str(data.get("cost_basis") or "").strip() or None
    if not title:
        raise HTTPException(status_code=502, detail="The oracle returned an empty reward.")

    try:
        point_cost = int(data.get("point_cost") or 50)
    except (TypeError, ValueError):
        point_cost = 50
    point_cost = min(AI_REWARD_MAX_POINT_COST, max(1, point_cost))

    return {
        "title": title,
        "description": description,
        "point_cost": point_cost,
        "category": category,
        "icon": icon,
        "cost_basis": cost_basis,
    }


async def _generate_with_gemini(
    config: AIProviderConfig,
    system_instruction: str,
    contents: str,
    response_schema: dict | None = None,
) -> dict:
    from google import genai

    response_schema = response_schema or _quest_response_schema()
    client = genai.Client(api_key=config.gemini_api_key)
    interaction = await client.aio.interactions.create(
        model=config.model,
        input=contents,
        system_instruction=system_instruction,
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": response_schema,
        },
        generation_config={
            "temperature": 0.9,
            "max_output_tokens": 600,
            "thinking_level": "low",
        },
    )
    return json.loads(interaction.output_text)


def _generate_with_openai(
    config: AIProviderConfig,
    system_instruction: str,
    contents: str,
) -> dict:
    headers = {
        "Authorization": f"Bearer {config.openai_api_key}",
        "Content-Type": "application/json",
    }
    if config.openai_organization:
        headers["OpenAI-Organization"] = config.openai_organization
    if config.openai_project:
        headers["OpenAI-Project"] = config.openai_project
    payload = {
        "model": config.model,
        "instructions": system_instruction,
        "input": contents,
    }
    data = _post_json("https://api.openai.com/v1/responses", payload, headers)
    text = data.get("output_text")
    if not text:
        chunks = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if isinstance(content, dict) and content.get("text"):
                    chunks.append(content["text"])
        text = "\n".join(chunks)
    return _parse_json_text(text)


def _generate_with_anthropic(
    config: AIProviderConfig,
    system_instruction: str,
    contents: str,
) -> dict:
    payload = {
        "model": config.model,
        "max_tokens": 600,
        "system": system_instruction,
        "messages": [{"role": "user", "content": contents}],
    }
    headers = {
        "x-api-key": config.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    data = _post_json("https://api.anthropic.com/v1/messages", payload, headers)
    text = "\n".join(
        part.get("text", "")
        for part in data.get("content", [])
        if isinstance(part, dict)
    )
    return _parse_json_text(text)


def _generate_with_ollama(
    config: AIProviderConfig,
    system_instruction: str,
    contents: str,
) -> dict:
    payload = {
        "model": config.model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": contents},
        ],
    }
    base_url = config.ollama_base_url.rstrip("/")
    data = _post_json(f"{base_url}/api/chat", payload, {"Content-Type": "application/json"})
    text = data.get("message", {}).get("content", "")
    return _parse_json_text(text)


def _parse_json_text(text: str) -> dict:
    if not text:
        raise ValueError("Provider returned empty text")
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("Provider returned non-JSON output")
    return json.loads(text[start:end + 1])


def _post_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        logger.warning("AI provider HTTP error %s for %s: %s", exc.code, url, body)
        raise


def _get_json(url: str, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        _ = exc.read()
        logger.warning("AI provider HTTP GET error %s", exc.code)
        raise


# ---------------------------------------------------------------------------
# Model discovery — list available models per provider for the Settings dropdown
# ---------------------------------------------------------------------------

def _list_gemini_models(config: AIProviderConfig) -> list[dict]:
    # REST ListModels (consistent with the other providers, avoids SDK pager
    # ambiguity). It reports generateContent support; the interactions API used
    # for generation accepts a subset, so validate-on-save is the backstop.
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key="
        + urllib.parse.quote(config.gemini_api_key, safe="")
    )
    data = _get_json(url, {"Content-Type": "application/json"})
    models = []
    for m in data.get("models", []):
        name = m.get("name", "")
        if not name.startswith("models/"):
            continue
        model_id = name[len("models/"):]
        if "gemini" not in model_id:
            continue
        if "generateContent" not in (m.get("supportedGenerationMethods") or []):
            continue
        models.append({"id": model_id, "label": m.get("displayName") or model_id})
    return models


def _list_openai_models(config: AIProviderConfig) -> list[dict]:
    headers = {"Authorization": f"Bearer {config.openai_api_key}"}
    if config.openai_organization:
        headers["OpenAI-Organization"] = config.openai_organization
    if config.openai_project:
        headers["OpenAI-Project"] = config.openai_project
    data = _get_json("https://api.openai.com/v1/models", headers)
    skip = (
        "embedding", "whisper", "tts", "dall-e", "audio",
        "image", "moderation", "realtime", "transcribe",
    )
    models = []
    for m in data.get("data", []):
        model_id = m.get("id", "")
        if not model_id or any(tok in model_id for tok in skip):
            continue
        if not (
            model_id.startswith("gpt")
            or model_id.startswith("o")
            or model_id.startswith("chatgpt")
        ):
            continue
        models.append({"id": model_id, "label": model_id})
    return models


def _list_anthropic_models(config: AIProviderConfig) -> list[dict]:
    headers = {
        "x-api-key": config.anthropic_api_key,
        "anthropic-version": "2023-06-01",
    }
    data = _get_json("https://api.anthropic.com/v1/models?limit=1000", headers)
    models = []
    for m in data.get("data", []):
        model_id = m.get("id", "")
        if model_id:
            models.append({"id": model_id, "label": m.get("display_name") or model_id})
    return models


def _list_ollama_models(config: AIProviderConfig) -> list[dict]:
    base_url = _validate_ollama_base_url(config.ollama_base_url).rstrip("/")
    data = _get_json(f"{base_url}/api/tags", {"Content-Type": "application/json"})
    models = []
    for m in data.get("models", []):
        name = m.get("name") or m.get("model")
        if name:
            models.append({"id": name, "label": name})
    return models


async def list_provider_models(config: AIProviderConfig) -> list[dict]:
    provider = config.provider
    secret_field = _PROVIDER_REQUIRED_SECRET_FIELD.get(provider)
    if secret_field and not getattr(config, secret_field, "").strip():
        raise HTTPException(
            status_code=400,
            detail="Enter or save an API key first to load available models.",
        )
    try:
        if provider == "gemini":
            models = await asyncio.to_thread(_list_gemini_models, config)
        elif provider == "openai":
            models = await asyncio.to_thread(_list_openai_models, config)
        elif provider == "anthropic":
            models = await asyncio.to_thread(_list_anthropic_models, config)
        elif provider == "ollama":
            models = await asyncio.to_thread(_list_ollama_models, config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported AI provider")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Listing models failed for provider %s", provider)
        raise _map_ai_provider_error(provider, exc)
    models.sort(key=lambda m: m["id"])
    return models


async def list_models_for_request(db: AsyncSession, body) -> list[dict]:
    """List models for a provider, using a request-supplied (possibly unsaved)
    key when present, else the saved/env key. Lets the Settings UI load models
    with a freshly-typed key before it's persisted."""
    provider = body.provider.strip().lower()
    if provider not in SUPPORTED_AI_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    base = await get_ai_provider_config(db)
    config = AIProviderConfig(
        provider=provider,
        model=base.model,
        gemini_api_key=(body.gemini_api_key or base.gemini_api_key or "").strip(),
        openai_api_key=(body.openai_api_key or base.openai_api_key or "").strip(),
        anthropic_api_key=(body.anthropic_api_key or base.anthropic_api_key or "").strip(),
        openai_organization=(
            body.openai_organization
            if body.openai_organization is not None
            else base.openai_organization
        ),
        openai_project=(
            body.openai_project
            if body.openai_project is not None
            else base.openai_project
        ),
        ollama_base_url=(body.ollama_base_url or base.ollama_base_url or DEFAULT_OLLAMA_BASE_URL),
    )
    return await list_provider_models(config)


# ---------------------------------------------------------------------------
# Validate-on-save — probe the chosen provider+model so a broken config is
# never persisted (the only reliable check that a model works with the API).
# ---------------------------------------------------------------------------

async def _probe_gemini(config: AIProviderConfig) -> None:
    from google import genai

    client = genai.Client(api_key=config.gemini_api_key)
    # Mirror the generation call shape (interactions API) with a tiny request.
    await client.aio.interactions.create(
        model=config.model,
        input="ping",
        system_instruction="Reply with a short JSON object.",
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": {
                "type": "object",
                "properties": {"ok": {"type": "string"}},
                "required": ["ok"],
            },
        },
        generation_config={"max_output_tokens": 64, "thinking_level": "low"},
    )


def _probe_openai(config: AIProviderConfig) -> None:
    headers = {
        "Authorization": f"Bearer {config.openai_api_key}",
        "Content-Type": "application/json",
    }
    if config.openai_organization:
        headers["OpenAI-Organization"] = config.openai_organization
    if config.openai_project:
        headers["OpenAI-Project"] = config.openai_project
    _post_json(
        "https://api.openai.com/v1/responses",
        {"model": config.model, "input": "ping", "max_output_tokens": 16},
        headers,
    )


def _probe_anthropic(config: AIProviderConfig) -> None:
    _post_json(
        "https://api.anthropic.com/v1/messages",
        {
            "model": config.model,
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "ping"}],
        },
        {
            "x-api-key": config.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )


def _probe_ollama(config: AIProviderConfig) -> None:
    base_url = _validate_ollama_base_url(config.ollama_base_url).rstrip("/")
    _post_json(
        f"{base_url}/api/chat",
        {
            "model": config.model,
            "stream": False,
            "messages": [{"role": "user", "content": "ping"}],
        },
        {"Content-Type": "application/json"},
    )


async def validate_ai_config(config: AIProviderConfig) -> None:
    """Probe the configured provider+model; raise a mapped HTTPException on
    failure so we never persist a config that will 502 at generation time."""
    if not config.is_configured:
        return
    try:
        if config.provider == "gemini":
            await _probe_gemini(config)
        elif config.provider == "openai":
            await asyncio.to_thread(_probe_openai, config)
        elif config.provider == "anthropic":
            await asyncio.to_thread(_probe_anthropic, config)
        elif config.provider == "ollama":
            await asyncio.to_thread(_probe_ollama, config)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "AI config validation failed for provider %s: %s", config.provider, exc
        )
        raise _map_ai_provider_error(config.provider, exc)


def _map_ai_provider_error(provider: str, exc: Exception) -> HTTPException:
    text = str(exc)
    lower = text.lower()
    if provider == "gemini":
        if "429" in text and "resource_exhausted" in lower:
            return HTTPException(
                status_code=503,
                detail="Gemini quota exceeded. Update the Gemini key/project or switch providers.",
            )
        if "not supported" in lower or "model family" in lower:
            return HTTPException(
                status_code=503,
                detail="The configured Gemini model isn't supported. Choose a current model (e.g. gemini-flash-latest) in Family Settings → AI Quest Generation.",
            )
        if "404" in text and "no longer available" in lower:
            return HTTPException(
                status_code=503,
                detail="The configured Gemini model is no longer available. Choose a current Gemini model in Family Settings.",
            )
        if "401" in text or "403" in text:
            return HTTPException(
                status_code=503,
                detail="Gemini rejected the API key. Check the saved Gemini key and its project restrictions.",
            )
    return HTTPException(
        status_code=502,
        detail="The oracle could not be reached. Please try again.",
    )
