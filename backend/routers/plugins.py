"""Plugins page API: list, configure, test and sync optional plugins."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.dependencies import require_parent
from backend.models import AuditLog, User
from backend.plugins import PLUGINS, Plugin, PluginError
from backend.plugins import manager

router = APIRouter(prefix="/api/plugins", tags=["plugins"])


class PluginUpdate(BaseModel):
    enabled: bool
    config: dict = Field(default_factory=dict)


class PluginTestRequest(BaseModel):
    config: dict = Field(default_factory=dict)


def _plugin_or_404(key: str) -> Plugin:
    try:
        return manager.get_plugin(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")


def _merge(plugin: Plugin, saved: dict, incoming: dict) -> dict:
    """Overlay submitted values on the saved config.

    Unknown keys are dropped, and a blank secret keeps the saved one so the
    UI never needs to see (or resend) a stored key — unless the field it is
    bound to (e.g. the device URL) changed, in which case it must be re-entered.
    """
    merged = dict(saved)
    for f in plugin.fields:
        if f.key in incoming and not (f.type == "secret" and not incoming[f.key]):
            merged[f.key] = incoming[f.key]
    for f in plugin.fields:
        if f.type == "secret" and f.bound_to and not incoming.get(f.key):
            if merged.get(f.bound_to) != saved.get(f.bound_to):
                merged[f.key] = ""
    return merged


def _public_view(plugin: Plugin, enabled: bool, config: dict) -> dict:
    visible = {k: v for k, v in config.items() if k not in plugin.secret_keys}
    return {
        **plugin.describe(),
        "enabled": enabled,
        "config": visible,
        "secrets_set": {k: bool(config.get(k)) for k in plugin.secret_keys},
        "status": manager.get_status(plugin.key),
    }


@router.get("")
async def list_plugins(
    db: AsyncSession = Depends(get_db),
    _parent: User = Depends(require_parent),
):
    out = []
    for plugin in PLUGINS.values():
        enabled, config = await manager.load_plugin(db, plugin)
        out.append(_public_view(plugin, enabled, config))
    return out


@router.put("/{key}")
async def update_plugin(
    key: str,
    body: PluginUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    parent: User = Depends(require_parent),
):
    plugin = _plugin_or_404(key)
    was_enabled, saved = await manager.load_plugin(db, plugin)
    config = _merge(plugin, saved, body.config)
    if body.enabled:
        try:
            config = plugin.validate(config)
        except PluginError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    await manager.save_plugin(db, plugin, body.enabled, config)
    if was_enabled != body.enabled:
        db.add(AuditLog(
            user_id=parent.id,
            action="plugin_enabled" if body.enabled else "plugin_disabled",
            details={"plugin": key},
            ip_address=request.client.host if request.client else None,
        ))
    await db.commit()

    if body.enabled:
        status = await manager.run_plugin(plugin, config)
    elif was_enabled:
        # Use the config the plugin was running with so cleanup reaches
        # the same router/alias.
        status = await manager.disable_plugin(plugin, saved)
    else:
        status = manager.get_status(key)
    view = _public_view(plugin, body.enabled, config)
    view["status"] = status
    return view


@router.post("/{key}/test")
async def test_plugin(
    key: str,
    body: PluginTestRequest,
    db: AsyncSession = Depends(get_db),
    _parent: User = Depends(require_parent),
):
    """Check unsaved settings (blank secrets fall back to the saved ones)."""
    plugin = _plugin_or_404(key)
    _enabled, saved = await manager.load_plugin(db, plugin)
    config = _merge(plugin, saved, body.config)
    try:
        return {"ok": True, "message": await plugin.test(config)}
    except PluginError as exc:
        return {"ok": False, "message": str(exc)}


@router.post("/{key}/sync")
async def sync_plugin(
    key: str,
    db: AsyncSession = Depends(get_db),
    _parent: User = Depends(require_parent),
):
    plugin = _plugin_or_404(key)
    enabled, config = await manager.load_plugin(db, plugin)
    if not enabled:
        raise HTTPException(status_code=400, detail="Enable the plugin first")
    return await manager.run_plugin(plugin, config)
