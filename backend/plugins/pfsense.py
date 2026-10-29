"""pfSense plugin: keep kids' devices offline until their quests are done.

Talks to the community pfSense REST API package (pfSense-pkg-RESTAPI, v2,
https://github.com/jaredhendrickson13/pfsense-api). ChoreQuest owns one
firewall *host alias* and rewrites its contents every sync. Devices given as
a MAC address or name are looked up in pfSense's DHCP leases and ARP table,
so they keep being blocked when their IP changes.

The three firewall rules that use the alias are created on request by the
"Set up firewall rules" button (``setup_rules``), never automatically.
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
from backend.plugins.internet_lockout import (
    KIND_IP, KIND_MAC, KIND_NAME, InternetLockoutPlugin, Resolution, normalise_mac, parse_address,
)

logger = logging.getLogger(__name__)

_ALIAS_NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,31}$")
_INTERFACE_RE = re.compile(r"^[A-Za-z0-9_.]{1,32}$")
_TIMEOUT_SECONDS = 15
# Lease states that no longer point at the device.
_STALE_LEASE_STATES = {"expired", "released", "free", "abandoned", "backup"}

RULE_DNS = "ChoreQuest: let blocked devices use DNS"
RULE_APP = "ChoreQuest: let blocked devices open ChoreQuest"
RULE_BLOCK = "ChoreQuest: block devices with unfinished quests"
RULE_PREFIX = "ChoreQuest:"


def _is_hostname(value: str) -> bool:
    try:
        return parse_address(value)[0] == KIND_NAME
    except PluginError:
        return False


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

    async def apply_changes(self) -> None:
        await self.request("POST", "/api/v2/firewall/apply", body={})

    async def get_rules(self) -> list[dict]:
        data = await self.request("GET", "/api/v2/firewall/rules",
                                  query={"descr__startswith": RULE_PREFIX})
        return [r for r in data or [] if str(r.get("descr", "")).startswith(RULE_PREFIX)]

    async def put_rule_on_top(self, rule: dict) -> None:
        """Create the rule (matched by description) or update it, as rule #0."""
        existing = next((r for r in await self.get_rules() if r.get("descr") == rule["descr"]), None)
        if existing is None:
            await self.request("POST", "/api/v2/firewall/rule", body={**rule, "placement": 0})
        else:
            await self.request("PATCH", "/api/v2/firewall/rule",
                               body={**rule, "id": existing["id"], "placement": 0})

    async def get_leases(self) -> list[dict]:
        return await self.request("GET", "/api/v2/status/dhcp_server/leases") or []

    async def get_arp_table(self) -> list[dict]:
        return await self.request("GET", "/api/v2/diagnostics/arp_table") or []


class PfSensePlugin(InternetLockoutPlugin):
    key = "pfsense"
    name = "pfSense Internet Lockout"
    description = (
        "Turns off the internet on your kids' devices at your pfSense firewall "
        "until their quests for today are done, then turns it back on automatically."
    )
    setup_steps = [
        "On pfSense, install the REST API package (see github.com/jaredhendrickson13/pfsense-api) "
        "and create an API key under System > REST API > Keys.",
        "Enter the pfSense address and API key below and press Test connection.",
        "Add a device group for each kid and pick their devices from the network list.",
        "Turn the plugin on, Save, then press Set up firewall rules (only needed once).",
    ]
    actions = [
        {
            "key": "setup_rules",
            "label": "Set up firewall rules",
            "help": (
                "Adds three rules at the top of the pfSense rule list: blocked devices may "
                "still look up names and open ChoreQuest, everything else is blocked. "
                "Safe to press again — it fixes the rules instead of duplicating them."
            ),
        },
    ]
    lists_network_devices = True
    router_fields = [
        ConfigField(
            key="base_url",
            label="pfSense address",
            placeholder="https://192.168.1.1",
            required=True,
            help="The address you use to open the pfSense web page.",
        ),
        ConfigField(
            key="api_key",
            label="REST API key",
            type="secret",
            required=True,
            bound_to="base_url",
            help="Stored encrypted. Leave blank to keep the saved key (re-enter it if you change the address).",
        ),
        ConfigField(
            key="verify_tls",
            label="Check pfSense's security certificate",
            type="bool",
            default=False,
            help=(
                "Most home pfSense boxes use a self-signed certificate, so this is off. "
                "Turn it on if yours has a real certificate."
            ),
            advanced=True,
        ),
        ConfigField(
            key="chorequest_address",
            label="ChoreQuest server IP",
            placeholder="192.168.1.10",
            help="The IP of the computer running ChoreQuest, so blocked devices can still open it to submit quests.",
        ),
        ConfigField(
            key="kill_states",
            label="Cut off open connections",
            type="bool",
            default=True,
            help="Stops videos and games right away when a device gets blocked.",
            advanced=True,
        ),
        ConfigField(
            key="alias_name",
            label="Firewall alias name",
            default="ChoreQuest_Blocked",
            help="ChoreQuest owns this alias and rewrites it every minute.",
            advanced=True,
        ),
        ConfigField(
            key="interface",
            label="Network interface",
            default="lan",
            help="The pfSense interface the kids' devices are on — usually lan.",
            advanced=True,
        ),
    ]

    def validate(self, config: dict) -> dict:
        config = super().validate(config)
        url = (config.get("base_url") or "").strip().rstrip("/")
        if url and "://" not in url:
            url = f"https://{url}"
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise PluginError("pfSense address must look like https://192.168.1.1")
        config["base_url"] = url
        alias = (config.get("alias_name") or "ChoreQuest_Blocked").strip()
        if not _ALIAS_NAME_RE.match(alias):
            raise PluginError("Alias name may only use letters, digits and _ (max 31)")
        config["alias_name"] = alias
        interface = (config.get("interface") or "lan").strip()
        if not _INTERFACE_RE.match(interface):
            raise PluginError("Network interface should look like lan or opt1")
        config["interface"] = interface
        address = (config.get("chorequest_address") or "").strip()
        if address:
            try:
                address = str(ipaddress.ip_address(address))
            except ValueError:
                raise PluginError("ChoreQuest server IP must be an IP address like 192.168.1.10")
        config["chorequest_address"] = address
        return config

    def _client(self, config: dict) -> PfSenseClient:
        if not config.get("base_url") or not config.get("api_key"):
            raise PluginError("pfSense address and API key are required")
        return PfSenseClient(config["base_url"], config["api_key"], bool(config.get("verify_tls", False)))

    # -- Devices ------------------------------------------------------------

    async def _network_devices(self, client: PfSenseClient) -> list[dict]:
        """Current devices from DHCP leases, topped up from the ARP table."""
        by_mac: dict[str, dict] = {}
        for lease in await client.get_leases():
            mac = normalise_mac(lease.get("mac"))
            ip = lease.get("ip")
            if not mac or not ip or str(lease.get("active_status") or "").lower() in _STALE_LEASE_STATES:
                continue
            device = by_mac.setdefault(mac, {"mac": mac, "ips": [], "names": [], "online": False})
            if ip not in device["ips"]:
                device["ips"].append(ip)
            for name in (lease.get("hostname"), lease.get("descr")):
                if name and name not in device["names"]:
                    device["names"].append(name)
            device["online"] |= str(lease.get("online_status") or "").lower().startswith("online")
        try:
            arp = await client.get_arp_table()
        except PluginError as exc:
            logger.info("pfSense: ARP table unavailable (%s); using DHCP leases only", exc)
            arp = []
        for entry in arp:
            mac = normalise_mac(entry.get("mac_address"))
            ip = entry.get("ip_address")
            if not mac or not ip:
                continue
            device = by_mac.setdefault(mac, {"mac": mac, "ips": [], "names": [], "online": False})
            if ip not in device["ips"]:
                device["ips"].append(ip)
            hostname = entry.get("hostname")
            if hostname and hostname != "?" and hostname not in device["names"]:
                device["names"].append(hostname)
            device["online"] = True
        return list(by_mac.values())

    async def list_network_devices(self, config: dict) -> list[dict]:
        devices = await self._network_devices(self._client(self.validate(config)))
        out = [
            {
                "name": d["names"][0] if d["names"] else "",
                "ip": d["ips"][0] if d["ips"] else "",
                "mac": d["mac"],
                # A name the parent can block by ("" if the device has none).
                "hostname": next((n for n in d["names"] if _is_hostname(n)), ""),
                "online": d["online"],
            }
            for d in devices
        ]
        return sorted(out, key=lambda d: (not d["online"], (d["name"] or "~").lower(), d["ip"]))

    async def resolve_addresses(self, config: dict, devices: list[dict]) -> dict[str, Resolution]:
        out: dict[str, Resolution] = {}
        lookups = [d for d in devices if d["kind"] != KIND_IP]
        network = await self._network_devices(self._client(config)) if lookups else []
        by_mac = {d["mac"]: d["ips"] for d in network}
        by_name: dict[str, list[str]] = {}
        for d in network:
            for name in d["names"]:
                lowered = name.lower()
                for key in {lowered, lowered.split(".")[0]}:
                    ips = by_name.setdefault(key, [])
                    for ip in d["ips"]:
                        if ip not in ips:
                            ips.append(ip)

        for device in devices:
            address = device["address"]
            if device["kind"] == KIND_IP:
                out[address] = Resolution([address])
            elif device["kind"] == KIND_MAC:
                ips = by_mac.get(address)
                out[address] = Resolution(ips) if ips else Resolution(
                    note="Not on the network right now — it will be blocked as soon as it connects")
            else:
                ips = by_name.get(address) or by_name.get(address.split(".")[0])
                if ips:
                    out[address] = Resolution(ips)
                elif "." in address:
                    # A full DNS name: pfSense can look it up itself.
                    out[address] = Resolution([address], note="pfSense looks this name up")
                else:
                    out[address] = Resolution(
                        note="No device with this name on the network right now")
        return out

    # -- Blocking -----------------------------------------------------------

    async def apply_blocklist(self, config: dict, entries: list[tuple[str, str]]) -> str:
        client = self._client(config)
        name = config.get("alias_name") or "ChoreQuest_Blocked"
        addresses = [address for address, _ in entries]
        # pfSense separates alias details with "||"
        details = [d.replace("||", "|") for _, d in entries]

        alias = await client.get_alias(name)
        if alias is None:
            await client.create_alias(name, addresses, details)
            newly_blocked = addresses
        else:
            if alias.get("type") != "host":
                raise PluginError(f"Alias '{name}' exists but is not a Host alias")
            current = set(alias.get("address") or [])
            if current == set(addresses):
                return self._summary(addresses)
            await client.update_alias(alias.get("id"), addresses, details)
            newly_blocked = [a for a in addresses if a not in current]

        if config.get("kill_states", True):
            for address in newly_blocked:
                try:
                    if ipaddress.ip_address(address).version != 4:
                        continue
                except ValueError:
                    continue  # a DNS name — pfSense resolves it, no state to match
                try:
                    await client.kill_states(address)
                except PluginError as exc:
                    # Not fatal: the rule still blocks new connections.
                    logger.warning("pfSense: could not clear states for %s: %s", address, exc)
        return self._summary(addresses)

    @staticmethod
    def _summary(addresses: list[str]) -> str:
        if not addresses:
            return "Nobody is blocked right now"
        return f"Blocking {len(addresses)} address{'es' if len(addresses) != 1 else ''}"

    async def health_warnings(self, config: dict) -> list[str]:
        try:
            rules = {r.get("descr") for r in await self._client(config).get_rules()}
        except PluginError as exc:
            return [f"Couldn't check the firewall rules: {exc}"]
        if RULE_BLOCK not in rules:
            return ["Firewall rules aren't set up yet, so nothing is actually blocked. "
                    "Press 'Set up firewall rules'."]
        return []

    # -- Setup --------------------------------------------------------------

    def _rules(self, config: dict) -> list[dict]:
        alias = config["alias_name"]
        iface = [config["interface"]]
        app_ip = config["chorequest_address"]
        app_family = "inet6" if ipaddress.ip_address(app_ip).version == 6 else "inet"
        # In the order they must end up in, top first.
        return [
            {"type": "pass", "interface": iface, "ipprotocol": "inet46", "protocol": "tcp/udp",
             "source": alias, "destination": "(self)", "destination_port": "53",
             "descr": RULE_DNS},
            {"type": "pass", "interface": iface, "ipprotocol": app_family, "protocol": None,
             "source": alias, "destination": app_ip, "descr": RULE_APP},
            {"type": "reject", "interface": iface, "ipprotocol": "inet46", "protocol": None,
             "source": alias, "destination": "any", "descr": RULE_BLOCK},
        ]

    async def run_action(self, action: str, config: dict) -> str:
        if action != "setup_rules":
            raise PluginError("Unknown action")
        if not config.get("chorequest_address"):
            raise PluginError("Fill in the ChoreQuest server IP first, so blocked devices can still reach ChoreQuest")
        client = self._client(config)
        # Rules can only point at an alias that exists.
        if await client.get_alias(config["alias_name"]) is None:
            await client.create_alias(config["alias_name"], [], [])
        # Each rule goes to the top, so add them bottom-up.
        for rule in reversed(self._rules(config)):
            await client.put_rule_on_top(rule)
        await client.apply_changes()
        return "Firewall rules are set up at the top of the pfSense rule list."

    async def test(self, config: dict) -> str:
        config = self.validate(config)
        client = self._client(config)
        alias = await client.get_alias(config["alias_name"])
        if alias is not None and alias.get("type") != "host":
            raise PluginError(f"Alias '{config['alias_name']}' exists but is not a Host alias")
        devices = await self._network_devices(client)
        rules = {r.get("descr") for r in await client.get_rules()}
        rules_note = (
            "Firewall rules are set up."
            if RULE_BLOCK in rules
            else "Firewall rules aren't set up yet — press 'Set up firewall rules' after saving."
        )
        return f"Connected to pfSense and found {len(devices)} devices on your network. {rules_note}"
