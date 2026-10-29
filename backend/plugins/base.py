"""Building blocks for optional ChoreQuest plugins.

A plugin is an optional integration (a router, a smart-home hub, ...) that
parents switch on from the Plugins page. Every plugin is off until a parent
enables it. To add one, subclass :class:`Plugin`, describe its settings with
:class:`ConfigField`, and register an instance in ``backend/plugins/__init__.py``.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


class PluginError(Exception):
    """A user-facing failure (bad settings, unreachable device, API error)."""


# Field types the Plugins page knows how to render.
FIELD_TYPES = {"text", "secret", "bool", "time", "select", "number", "device_groups"}


@dataclass(frozen=True)
class ConfigField:
    key: str
    label: str
    type: str = "text"
    default: Any = None
    help: str = ""
    placeholder: str = ""
    required: bool = False
    # For "select": list of {"value": ..., "label": ...}
    options: list[dict] = field(default_factory=list)
    # For "secret": the field this secret belongs to (e.g. the device URL).
    # Changing that field requires re-entering the secret, so a saved key is
    # never sent to a different host.
    bound_to: str = ""
    # Hidden under "Advanced settings" — the defaults suit most homes.
    advanced: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


class Plugin:
    """Base class for plugins.

    Subclasses set the class attributes and override ``validate``, ``sync``,
    ``disable`` and ``test`` as needed. ``sync`` runs every minute while the
    plugin is enabled and soon after any quest is submitted, approved or
    reopened, so it should compute the desired state and make it so
    (idempotent), not react to a single change.
    """

    key: str = ""
    name: str = ""
    description: str = ""
    category: str = "General"
    # Markdown-free plain text shown on the plugin's card (setup steps etc.)
    setup_steps: list[str] = []
    fields: list[ConfigField] = []
    # One-off buttons on the plugin card: [{"key", "label", "help"}].
    # Each is handled by ``run_action``.
    actions: list[dict] = []
    # True if ``list_network_devices`` can offer a device picker.
    lists_network_devices: bool = False

    @property
    def secret_keys(self) -> set[str]:
        return {f.key for f in self.fields if f.type == "secret"}

    def defaults(self) -> dict:
        return {f.key: f.default for f in self.fields}

    def validate(self, config: dict) -> dict:
        """Return a cleaned copy of ``config``; raise PluginError if invalid.

        Only called when enabling or saving an enabled plugin, so a disabled
        plugin can be saved half-configured.
        """
        for f in self.fields:
            if f.required and config.get(f.key) in (None, "", [], {}):
                raise PluginError(f"{f.label} is required")
        return config

    async def sync(self, db: AsyncSession, config: dict) -> dict:
        """Bring the outside world in line with ChoreQuest; return a status
        dict with a human ``message``, optional ``details`` and optional
        ``ok`` (False shows the status as a warning)."""
        return {"message": "Nothing to do"}

    async def disable(self, config: dict) -> None:
        """Undo the plugin's effect when a parent switches it off."""

    async def test(self, config: dict) -> str:
        """Check the settings work without changing anything."""
        return "OK"

    async def run_action(self, action: str, config: dict) -> str:
        """Run one of ``actions``; return a message for the parent."""
        raise PluginError("Unknown action")

    async def list_network_devices(self, config: dict) -> list[dict]:
        """Devices the router can see: [{"name", "ip", "mac", "online"}]."""
        raise PluginError("This plugin can't list network devices")

    def describe(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "setup_steps": self.setup_steps,
            "fields": [f.to_dict() for f in self.fields],
            "actions": self.actions,
            "lists_network_devices": self.lists_network_devices,
        }
