"""Optional plugins. Register new plugins in PLUGINS below."""

from backend.plugins.base import ConfigField, Plugin, PluginError
from backend.plugins.pfsense import PfSensePlugin

PLUGINS: dict[str, Plugin] = {p.key: p for p in [PfSensePlugin()]}

__all__ = ["PLUGINS", "ConfigField", "Plugin", "PluginError"]
