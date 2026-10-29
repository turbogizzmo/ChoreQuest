"""Plugin storage, the background sync loop, and change hooks.

Each plugin's state lives in one ``AppSetting`` row keyed ``plugin.<key>``
holding ``{"enabled": bool, "config": {...}}``; secret fields are stored
encrypted with ``encrypt_secret``. Enabled plugins sync every
``SYNC_INTERVAL_SECONDS`` and shortly after any commit that touches a quest
assignment or vacation, so a kid's internet comes back seconds after they
submit their last quest.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from backend.database import async_session
from backend.models import AppSetting, ChoreAssignment, VacationPeriod
from backend.plugins import PLUGINS
from backend.plugins.base import Plugin, PluginError
from backend.services.secure_settings import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

SETTING_PREFIX = "plugin."
SYNC_INTERVAL_SECONDS = 60
# Wait briefly after a change so a burst of edits causes one sync.
DEBOUNCE_SECONDS = 2

_loop: asyncio.AbstractEventLoop | None = None
_wake: asyncio.Event | None = None
_locks: dict[str, asyncio.Lock] = {}
# In-memory last result per plugin, shown on the Plugins page.
_status: dict[str, dict] = {}


def setting_key(plugin_key: str) -> str:
    return f"{SETTING_PREFIX}{plugin_key}"


def get_plugin(key: str) -> Plugin:
    plugin = PLUGINS.get(key)
    if plugin is None:
        raise KeyError(key)
    return plugin


async def load_plugin(db: AsyncSession, plugin: Plugin) -> tuple[bool, dict]:
    """Return (enabled, config) with secrets decrypted and defaults filled."""
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == setting_key(plugin.key)))
    ).scalar_one_or_none()
    config = plugin.defaults()
    enabled = False
    if row is not None:
        try:
            stored = json.loads(row.value)
        except ValueError:
            logger.warning("Plugin %s: stored settings are not valid JSON", plugin.key)
            stored = {}
        enabled = bool(stored.get("enabled"))
        config.update(stored.get("config") or {})
    for key in plugin.secret_keys:
        if config.get(key):
            try:
                config[key] = decrypt_secret(config[key])
            except ValueError:
                logger.warning("Plugin %s: could not decrypt %s", plugin.key, key)
                config[key] = ""
    return enabled, config


async def save_plugin(db: AsyncSession, plugin: Plugin, enabled: bool, config: dict) -> None:
    stored = dict(config)
    for key in plugin.secret_keys:
        if stored.get(key):
            stored[key] = encrypt_secret(stored[key])
    value = json.dumps({"enabled": enabled, "config": stored})
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == setting_key(plugin.key)))
    ).scalar_one_or_none()
    if row is None:
        db.add(AppSetting(key=setting_key(plugin.key), value=value))
    else:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)


def get_status(key: str) -> dict | None:
    return _status.get(key)


def _record(key: str, ok: bool, message: str, details: dict | None = None) -> dict:
    status = {
        "ok": ok,
        "message": message,
        "details": details or {},
        "at": datetime.now(timezone.utc).isoformat(),
    }
    _status[key] = status
    return status


async def run_plugin(plugin: Plugin, config: dict) -> dict:
    """Sync one plugin with an already-loaded config; never raises."""
    lock = _locks.setdefault(plugin.key, asyncio.Lock())
    async with lock:
        try:
            async with async_session() as db:
                result = await plugin.sync(db, config)
            return _record(plugin.key, result.get("ok", True), result.get("message", "OK"),
                           result.get("details"))
        except PluginError as exc:
            logger.warning("Plugin %s sync failed: %s", plugin.key, exc)
            return _record(plugin.key, False, str(exc))
        except Exception:
            logger.exception("Plugin %s sync crashed", plugin.key)
            return _record(plugin.key, False, "Unexpected error — see server logs")


async def disable_plugin(plugin: Plugin, config: dict) -> dict:
    """Undo a plugin's effect after it is switched off; never raises."""
    lock = _locks.setdefault(plugin.key, asyncio.Lock())
    async with lock:
        try:
            await plugin.disable(config)
            return _record(plugin.key, True, "Disabled — all devices unblocked")
        except PluginError as exc:
            return _record(plugin.key, False, f"Disabled, but cleanup failed: {exc}")
        except Exception:
            logger.exception("Plugin %s disable crashed", plugin.key)
            return _record(plugin.key, False, "Disabled, but cleanup failed — see server logs")


async def sync_enabled_plugins() -> None:
    for plugin in PLUGINS.values():
        async with async_session() as db:
            enabled, config = await load_plugin(db, plugin)
        if enabled:
            await run_plugin(plugin, config)


async def plugin_sync_task() -> None:
    """Background loop: sync enabled plugins every minute or when woken."""
    await asyncio.sleep(5)  # let startup/seed finish first
    while True:
        try:
            if _wake is None:
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)
            else:
                await asyncio.wait_for(_wake.wait(), timeout=SYNC_INTERVAL_SECONDS)
                await asyncio.sleep(DEBOUNCE_SECONDS)
        except asyncio.TimeoutError:
            pass
        if _wake is not None:
            _wake.clear()
        try:
            await sync_enabled_plugins()
        except Exception:
            logger.exception("Plugin sync loop error")


def request_sync() -> None:
    """Ask the loop to sync soon. Safe to call from any thread."""
    if _loop is not None and _wake is not None:
        _loop.call_soon_threadsafe(_wake.set)


_WATCHED = (ChoreAssignment, VacationPeriod)


def _after_flush(session: Session, flush_context):
    if any(isinstance(obj, _WATCHED) for obj in (*session.new, *session.dirty, *session.deleted)):
        session.info["_plugin_sync"] = True


def _after_commit(session: Session):
    if session.info.pop("_plugin_sync", False):
        request_sync()


def _after_rollback(session: Session, previous_transaction):
    session.info.pop("_plugin_sync", None)


def install_plugin_hooks() -> None:
    """Register SQLAlchemy listeners. Call once at startup."""
    global _loop, _wake
    _loop = asyncio.get_running_loop()
    _wake = asyncio.Event()
    event.listen(Session, "after_flush", _after_flush)
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_soft_rollback", _after_rollback)
