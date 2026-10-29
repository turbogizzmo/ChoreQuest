"""Shared "no internet until quests are done" logic for router plugins.

Parents set up **device groups** ("Alice's devices", "Living room TV"). Each
group lists devices, given as an IP address, a MAC address or a device name,
and the kids it belongs to. A group is offline while any of its kids still
has quests to do.

Deciding *who* is locked out lives here. Each router plugin (pfSense today,
others later) implements :meth:`InternetLockoutPlugin.resolve_addresses`
(MAC/name → current IPs) and :meth:`InternetLockoutPlugin.apply_blocklist`
(make the router block exactly these addresses).
"""

import ipaddress
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AssignmentStatus, Chore, ChoreAssignment, User, UserRole
from backend.plugins.base import ConfigField, Plugin, PluginError

logger = logging.getLogger(__name__)

UNLOCK_ON_SUBMITTED = "submitted"
UNLOCK_ON_VERIFIED = "verified"

KIND_IP = "ip"
KIND_MAC = "mac"
KIND_NAME = "name"

MAX_GROUPS = 50
MAX_DEVICES_PER_GROUP = 100

LOCKOUT_FIELDS = [
    ConfigField(
        key="groups",
        label="Device groups",
        type="device_groups",
        default=[],
        help=(
            "Make a group for each kid (or for shared things like the living-room TV), "
            "add its devices, and pick whose quests it waits for."
        ),
    ),
    ConfigField(
        key="unlock_on",
        label="Unlock internet when",
        type="select",
        default=UNLOCK_ON_SUBMITTED,
        options=[
            {"value": UNLOCK_ON_SUBMITTED, "label": "All of today's quests are submitted"},
            {"value": UNLOCK_ON_VERIFIED, "label": "All of today's quests are approved by a parent"},
        ],
    ),
    ConfigField(
        key="block_start",
        label="Lockout window starts",
        type="time",
        default="00:00",
        help="Set start and end to the same time to enforce all day.",
    ),
    ConfigField(
        key="block_end",
        label="Lockout window ends",
        type="time",
        default="00:00",
        help="Outside the window every device is allowed. The window may cross midnight.",
    ),
]

_MAC_RE = re.compile(r"^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$", re.I)
_CISCO_MAC_RE = re.compile(r"^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$", re.I)
_NAME_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$"
)


def parse_address(raw) -> tuple[str, str]:
    """Work out what a parent typed: returns (kind, normalised value)."""
    value = str(raw or "").strip()
    if not value:
        raise PluginError("Device address is empty")
    try:
        return KIND_IP, str(ipaddress.ip_address(value))
    except ValueError:
        pass
    if _MAC_RE.match(value) or _CISCO_MAC_RE.match(value):
        digits = re.sub(r"[^0-9a-f]", "", value.lower())
        return KIND_MAC, ":".join(digits[i:i + 2] for i in range(0, 12, 2))
    name = value.lower().rstrip(".")
    if _NAME_RE.match(name):
        return KIND_NAME, name
    raise PluginError(f"'{value}' doesn't look like an IP address, MAC address or device name")


def normalise_mac(value) -> str | None:
    try:
        kind, mac = parse_address(value)
    except PluginError:
        return None
    return mac if kind == KIND_MAC else None


def clean_groups(raw) -> list[dict]:
    """Validate and normalise the device-group list from the settings form."""
    if not raw:
        return []
    if not isinstance(raw, list):
        raise PluginError("Device groups must be a list")
    if len(raw) > MAX_GROUPS:
        raise PluginError(f"At most {MAX_GROUPS} device groups")
    groups = []
    for i, group in enumerate(raw, start=1):
        if not isinstance(group, dict):
            raise PluginError("Invalid device group")
        name = str(group.get("name") or "").strip()[:50] or f"Group {i}"
        kid_ids = []
        for kid_id in group.get("kid_ids") or []:
            try:
                kid_id = int(kid_id)
            except (TypeError, ValueError):
                raise PluginError(f"{name}: invalid kid")
            if kid_id not in kid_ids:
                kid_ids.append(kid_id)
        devices, seen = [], set()
        raw_devices = group.get("devices") or []
        if len(raw_devices) > MAX_DEVICES_PER_GROUP:
            raise PluginError(f"{name}: at most {MAX_DEVICES_PER_GROUP} devices")
        for device in raw_devices:
            if not isinstance(device, dict):
                raise PluginError(f"{name}: invalid device")
            if not str(device.get("address") or "").strip():
                continue  # blank row left in the form
            try:
                kind, address = parse_address(device.get("address"))
            except PluginError as exc:
                raise PluginError(f"{name}: {exc}")
            if address in seen:
                continue
            seen.add(address)
            devices.append({
                "name": str(device.get("name") or "").strip()[:50],
                "address": address,
                "kind": kind,
            })
        groups.append({
            "id": str(group.get("id") or uuid.uuid4().hex[:8])[:20],
            "name": name,
            "kid_ids": kid_ids,
            "devices": devices,
        })
    return groups


def parse_hhmm(value: str, label: str) -> time:
    try:
        hour, minute = (int(p) for p in str(value).split(":", 1))
        return time(hour, minute)
    except (TypeError, ValueError):
        raise PluginError(f"{label} must be a time like 15:30")


def in_window(now: time, start: time, end: time) -> bool:
    if start == end:
        return True
    if start < end:
        return start <= now < end
    return now >= start or now < end  # crosses midnight


def validate_lockout_config(config: dict) -> dict:
    config = dict(config)
    config["groups"] = clean_groups(config.get("groups"))
    if config.get("unlock_on") not in (UNLOCK_ON_SUBMITTED, UNLOCK_ON_VERIFIED):
        config["unlock_on"] = UNLOCK_ON_SUBMITTED
    parse_hhmm(config.get("block_start") or "00:00", "Lockout window start")
    parse_hhmm(config.get("block_end") or "00:00", "Lockout window end")
    return config


@dataclass
class KidState:
    user_id: int
    display_name: str
    blocked: bool
    reason: str

    def to_dict(self) -> dict:
        return {"user_id": self.user_id, "display_name": self.display_name,
                "blocked": self.blocked, "reason": self.reason}


@dataclass
class GroupLockout:
    id: str
    name: str
    devices: list[dict]
    blocked: bool
    reason: str
    kids: list[KidState] = field(default_factory=list)


@dataclass
class LockoutPlan:
    groups: list[GroupLockout] = field(default_factory=list)

    @property
    def blocked_devices(self) -> list[tuple[str, str]]:
        """(address, description) of every device in a blocked group."""
        out = []
        for group in self.groups:
            if group.blocked:
                for device in group.devices:
                    label = f"{group.name} - {device['name']}" if device["name"] else group.name
                    out.append((device["address"], f"ChoreQuest: {label}"))
        return out


@dataclass
class Resolution:
    """Where a device is right now: its IPs (or FQDN), or why it can't be found."""
    targets: list[str] = field(default_factory=list)
    note: str = ""


async def compute_lockout(
    db: AsyncSession, config: dict, now: datetime | None = None
) -> LockoutPlan:
    """Work out which device groups should be offline right now.

    ``now`` is *local* time (``datetime.now()``) — the window and "today"
    are family calendar concepts, never UTC.
    """
    from backend.routers.vacation import is_vacation_day

    now = now or datetime.now()
    today: date = now.date()
    groups = clean_groups(config.get("groups"))
    start = parse_hhmm(config.get("block_start") or "00:00", "Lockout window start")
    end = parse_hhmm(config.get("block_end") or "00:00", "Lockout window end")
    window_open = in_window(now.time(), start, end)
    verified_mode = config.get("unlock_on") == UNLOCK_ON_VERIFIED

    blocking = [AssignmentStatus.pending]
    if verified_mode:
        blocking.append(AssignmentStatus.completed)

    kids = (
        await db.execute(select(User).where(User.role == UserRole.kid, User.is_active == True))
    ).scalars().all()

    # Optional bounty quests never lock anyone out.
    counts = dict(
        (
            await db.execute(
                select(ChoreAssignment.user_id, func.count(ChoreAssignment.id))
                .join(Chore, Chore.id == ChoreAssignment.chore_id)
                .where(
                    ChoreAssignment.date == today,
                    ChoreAssignment.status.in_(blocking),
                    Chore.is_active == True,
                    Chore.is_bounty == False,
                )
                .group_by(ChoreAssignment.user_id)
            )
        ).all()
    )

    kid_states: dict[int, KidState] = {}
    for kid in kids:
        outstanding = counts.get(kid.id, 0)
        if await is_vacation_day(db, today, user_id=kid.id):
            state = KidState(kid.id, kid.display_name, False, "on vacation")
        elif outstanding:
            quests = f"{outstanding} quest{'s' if outstanding != 1 else ''}"
            reason = f"{quests} not approved yet" if verified_mode else f"{quests} left to do"
            state = KidState(kid.id, kid.display_name, True, reason)
        else:
            state = KidState(kid.id, kid.display_name, False, "all quests done")
        kid_states[kid.id] = state

    plan = LockoutPlan()
    for group in groups:
        members = [kid_states[k] for k in group["kid_ids"] if k in kid_states]
        if not members:
            blocked, reason = False, "No kids picked for this group"
        elif not group["devices"]:
            blocked, reason = False, "No devices in this group"
        elif not window_open:
            blocked, reason = False, "Outside the lockout window"
        else:
            waiting_on = [k for k in members if k.blocked]
            blocked = bool(waiting_on)
            if blocked:
                reason = "; ".join(f"{k.display_name}: {k.reason}" for k in waiting_on)
            elif len(members) == 1:
                reason = f"{members[0].display_name}: {members[0].reason}"
            else:
                reason = "Everyone is done"
        plan.groups.append(GroupLockout(
            group["id"], group["name"], group["devices"], blocked, reason, members,
        ))
    return plan


class InternetLockoutPlugin(Plugin):
    """Base for router plugins: block device groups until quests are done."""

    category = "Internet control"
    router_fields: list[ConfigField] = []

    @property
    def fields(self) -> list[ConfigField]:  # type: ignore[override]
        return self.router_fields + LOCKOUT_FIELDS

    def validate(self, config: dict) -> dict:
        return validate_lockout_config(super().validate(config))

    async def resolve_addresses(self, config: dict, devices: list[dict]) -> dict[str, Resolution]:
        """Map each device address to what the router should block.

        The default handles IP addresses only; routers that can see their
        DHCP leases override this to find MAC addresses and device names.
        """
        out = {}
        for device in devices:
            if device["kind"] == KIND_IP:
                out[device["address"]] = Resolution([device["address"]])
            else:
                out[device["address"]] = Resolution(note="This router only supports IP addresses")
        return out

    async def apply_blocklist(self, config: dict, entries: list[tuple[str, str]]) -> str:
        """Make the router block exactly ``entries`` (address, description).

        Return a short summary of what changed. Must be idempotent.
        """
        raise NotImplementedError

    async def health_warnings(self, config: dict) -> list[str]:
        """Problems that stop blocking from working (e.g. missing rules)."""
        return []

    async def sync(self, db: AsyncSession, config: dict) -> dict:
        plan = await compute_lockout(db, config)
        all_devices = [d for g in plan.groups for d in g.devices]
        resolved = await self.resolve_addresses(config, all_devices) if all_devices else {}

        entries: dict[str, str] = {}
        for address, descr in plan.blocked_devices:
            for target in resolved.get(address, Resolution()).targets:
                entries.setdefault(target, descr)
        message = await self.apply_blocklist(config, sorted(entries.items()))

        warnings = await self.health_warnings(config)
        details = {
            "warnings": warnings,
            "groups": [
                {
                    "id": g.id,
                    "name": g.name,
                    "blocked": g.blocked,
                    "reason": g.reason,
                    "devices": [
                        {
                            "name": d["name"],
                            "address": d["address"],
                            "kind": d["kind"],
                            "targets": resolved.get(d["address"], Resolution()).targets,
                            "note": resolved.get(d["address"], Resolution()).note,
                        }
                        for d in g.devices
                    ],
                }
                for g in plan.groups
            ],
        }
        return {"message": message, "details": details, "ok": not warnings}

    async def disable(self, config: dict) -> None:
        await self.apply_blocklist(config, [])
