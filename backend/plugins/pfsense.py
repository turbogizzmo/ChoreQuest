"""pfSense plugin: keep kids' devices offline until their quests are done.

Talks to the community pfSense REST API package (pfSense-pkg-RESTAPI, v2,
https://github.com/jaredhendrickson13/pfsense-api). ChoreQuest owns one
firewall *host alias* and rewrites its contents; a parent creates a single
block rule on the LAN with that alias as the source. ChoreQuest never edits
firewall rules itself.
"""

import asyncio
import ipaddress
import json
import logging
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

from backend.plugins.base import ConfigField, PluginError
from backend.plugins.internet_lockout import InternetLockoutPlugin

logger = logging.getLogger(__name__)

_ALIAS_NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,31}$")
_TIMEOUT_SECONDS = 15


class PfSenseClient:
    def __init__(self, base_url: str, api_key: str, verify_tls: bool = True):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        if verify_tls:
            self._ssl = ssl.create_default_context()
        else:
            self._ssl = ssl.create_default_context()
            self._ssl.check_hostname = False
            self._ssl.verify_mode = ssl.CERT_NONE

    def _request_sync(self, method: str, path: str, *, query: dict | None = None,
                      body: dict | None = None):
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        headers = {"X-API-Key": self.api_key, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS, context=self._ssl) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            message = exc.reason
            try:
                message = json.loads(exc.read().decode("utf-8")).get("message") or message
            except (ValueError, AttributeError):
                pass
            if exc.code in (401, 403):
                message = f"pfSense rejected the API key ({message})"
            raise PluginError(f"pfSense API error {exc.code}: {message}")
        except ssl.SSLError as exc:
            raise PluginError(
                f"TLS error talking to pfSense ({exc.reason}). If pfSense uses a "
                "self-signed certificate, turn off 'Verify TLS certificate'."
            )
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise PluginError(f"Could not reach pfSense at {self.base_url}: {reason}")
        except ValueError:
            raise PluginError("pfSense returned a response that is not JSON. Is the REST API package installed?")
        return payload.get("data")

    async def request(self, method: str, path: str, **kwargs):
        return await asyncio.to_thread(self._request_sync, method, path, **kwargs)

    async def get_alias(self, name: str) -> dict | None:
        data = await self.request("GET", "/api/v2/firewall/aliases", query={"name": name})
        for alias in data or []:
            if alias.get("name") == name:
                return alias
        return None

    async def create_alias(self, name: str, addresses: list[str], details: list[str]) -> None:
        await self.request("POST", "/api/v2/firewall/alias", body={
            "name": name,
            "type": "host",
            "descr": "Managed by ChoreQuest - devices with unfinished quests",
            "address": addresses,
            "detail": details,
            "apply": True,
        })

    async def update_alias(self, alias_id, addresses: list[str], details: list[str]) -> None:
        await self.request("PATCH", "/api/v2/firewall/alias", body={
            "id": alias_id,
            "address": addresses,
            "detail": details,
            "apply": True,
        })

    async def kill_states(self, ip: str) -> None:
        """Drop open connections from ``ip`` so the block takes effect now.

        State sources look like ``192.168.1.20:51515``; IPv6 states use a
        different format, so only IPv4 is handled.
        """
        await self.request("DELETE", "/api/v2/firewall/states",
                           query={"source__startswith": f"{ip}:"})


class PfSensePlugin(InternetLockoutPlugin):
    key = "pfsense"
    name = "pfSense Internet Lockout"
    description = (
        "Blocks each kid's devices at your pfSense firewall until their quests "
        "for today are done, then unblocks them automatically."
    )
    setup_steps = [
        "On pfSense, install the REST API package (System > Package Manager, or "
        "see github.com/jaredhendrickson13/pfsense-api) and create an API key "
        "under System > REST API > Keys for a user with firewall alias and state privileges.",
        "Give every kid device a static DHCP mapping (Services > DHCP Server) and "
        "turn off private / random Wi-Fi MAC addresses on those devices.",
        "Fill in the settings below, enter each kid's device IPs, and press Test "
        "connection. Saving with the plugin enabled creates the alias on pfSense.",
        "On pfSense, add two LAN rules ABOVE the default allow rule: first Pass, "
        "source = the alias, destination = the ChoreQuest server's IP (so kids can "
        "still submit quests); then Reject, source = the alias, destination = any.",
    ]
    router_fields = [
        ConfigField(
            key="base_url",
            label="pfSense URL",
            placeholder="https://192.168.1.1",
            required=True,
            help="Address of the pfSense web interface, as seen from the ChoreQuest server.",
        ),
        ConfigField(
            key="api_key",
            label="REST API key",
            type="secret",
            required=True,
            bound_to="base_url",
            help="Stored encrypted. Leave blank to keep the saved key (re-enter it if you change the URL).",
        ),
        ConfigField(
            key="verify_tls",
            label="Verify TLS certificate",
            type="bool",
            default=True,
            help="Turn off only if pfSense uses its default self-signed certificate.",
        ),
        ConfigField(
            key="alias_name",
            label="Firewall alias name",
            default="ChoreQuest_Blocked",
            help="ChoreQuest replaces this alias's entries on every sync — don't edit it by hand.",
        ),
        ConfigField(
            key="kill_states",
            label="Cut off open connections",
            type="bool",
            default=True,
            help="Drops a device's existing connections when it gets blocked, so streams stop right away.",
        ),
    ]

    def validate(self, config: dict) -> dict:
        config = super().validate(config)
        url = (config.get("base_url") or "").strip().rstrip("/")
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise PluginError("pfSense URL must start with http:// or https://")
        config["base_url"] = url
        alias = (config.get("alias_name") or "ChoreQuest_Blocked").strip()
        if not _ALIAS_NAME_RE.match(alias):
            raise PluginError("Alias name may only use letters, digits and _ (max 31)")
        config["alias_name"] = alias
        return config

    def _client(self, config: dict) -> PfSenseClient:
        if not config.get("base_url") or not config.get("api_key"):
            raise PluginError("pfSense URL and API key are required")
        return PfSenseClient(config["base_url"], config["api_key"], bool(config.get("verify_tls", True)))

    async def test(self, config: dict) -> str:
        config = self.validate(config)
        alias = await self._client(config).get_alias(config["alias_name"])
        if alias is None:
            return f"Connected. Alias '{config['alias_name']}' will be created on the first sync."
        if alias.get("type") != "host":
            raise PluginError(f"Alias '{config['alias_name']}' exists but is not a Host alias")
        count = len(alias.get("address") or [])
        return f"Connected. Alias '{config['alias_name']}' currently blocks {count} address(es)."

    async def apply_blocklist(self, config: dict, entries: list[tuple[str, str]]) -> str:
        client = self._client(config)
        name = config.get("alias_name") or "ChoreQuest_Blocked"
        addresses = [ip for ip, _ in entries]
        # pfSense separates alias details with "||"
        details = [d.replace("||", "|") for _, d in entries]

        alias = await client.get_alias(name)
        if alias is None:
            await client.create_alias(name, addresses, details)
            newly_blocked = addresses
            summary = f"Created alias {name}"
        else:
            if alias.get("type") != "host":
                raise PluginError(f"Alias '{name}' exists but is not a Host alias")
            current = set(alias.get("address") or [])
            if current == set(addresses):
                return f"Up to date — {len(addresses)} device(s) blocked"
            await client.update_alias(alias.get("id"), addresses, details)
            newly_blocked = [ip for ip in addresses if ip not in current]
            summary = "Updated alias"

        if config.get("kill_states", True):
            for ip in newly_blocked:
                if ipaddress.ip_address(ip).version != 4:
                    continue
                try:
                    await client.kill_states(ip)
                except PluginError as exc:
                    # Not fatal: the rule still blocks new connections.
                    logger.warning("pfSense: could not clear states for %s: %s", ip, exc)
        return f"{summary} — {len(addresses)} device(s) blocked"
