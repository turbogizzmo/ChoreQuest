"""Shared "no internet until quests are done" logic for router plugins.

Deciding *who* is locked out lives here; each router plugin (pfSense today,
others later) only implements :meth:`InternetLockoutPlugin.apply_blocklist`,
which makes the router block exactly the given device addresses.
"""

import ipaddress
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AssignmentStatus, Chore, ChoreAssignment, User, UserRole
from backend.plugins.base import ConfigField, Plugin, PluginError

logger = logging.getLogger(__name__)

UNLOCK_ON_SUBMITTED = "submitted"
UNLOCK_ON_VERIFIED = "verified"

LOCKOUT_FIELDS = [
    ConfigField(
        key="devices",
        label="Kid devices",
        type="kid_devices",
        default={},
        help=(
            "IP addresses of each kid's devices. Give each device a static DHCP "
            "mapping on the router (and turn off private/random Wi-Fi MAC "
            "addresses on it) so the address never changes."
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
        help="Local time. Set start and end to the same time to enforce all day.",
    ),
    ConfigField(
        key="block_end",
        label="Lockout window ends",
        type="time",
        default="00:00",
        help="Outside the window every device is allowed. The window may cross midnight.",
    ),
]


@dataclass
class KidLockout:
    user_id: int
    display_name: str
    ips: list[str]
    blocked: bool
    reason: str
    outstanding: int = 0

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "display_name": self.display_name,
            "ips": self.ips,
            "blocked": self.blocked,
            "reason": self.reason,
            "outstanding": self.outstanding,
        }


@dataclass
class LockoutPlan:
    kids: list[KidLockout] = field(default_factory=list)

    @property
    def blocked_entries(self) -> list[tuple[str, str]]:
        """(ip, description) pairs to block, de-duplicated, stable order."""
        seen: dict[str, str] = {}
        for kid in self.kids:
            if not kid.blocked:
                continue
            for ip in kid.ips:
                seen.setdefault(ip, f"ChoreQuest: {kid.display_name}")
        return sorted(seen.items())


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


def clean_devices(raw) -> dict[str, list[str]]:
    """Normalise {"<kid id>": ["ip", ...]}; raise PluginError on a bad address."""
    if not raw:
        return {}
    if not isinstance(raw, dict):
        raise PluginError("Kid devices must map kids to address lists")
    cleaned: dict[str, list[str]] = {}
    for kid_id, ips in raw.items():
        try:
            kid_key = str(int(kid_id))
        except (TypeError, ValueError):
            raise PluginError(f"Invalid kid id: {kid_id}")
        if isinstance(ips, str):
            ips = [p for p in ips.replace(",", " ").split()]
        out: list[str] = []
        for ip in ips or []:
            ip = str(ip).strip()
            if not ip:
                continue
            try:
                ip = str(ipaddress.ip_address(ip))
            except ValueError:
                raise PluginError(f"'{ip}' is not a valid IP address")
            if ip not in out:
                out.append(ip)
        if out:
            cleaned[kid_key] = out
    return cleaned


def validate_lockout_config(config: dict) -> dict:
    config = dict(config)
    config["devices"] = clean_devices(config.get("devices"))
    if config.get("unlock_on") not in (UNLOCK_ON_SUBMITTED, UNLOCK_ON_VERIFIED):
        config["unlock_on"] = UNLOCK_ON_SUBMITTED
    parse_hhmm(config.get("block_start") or "00:00", "Lockout window start")
    parse_hhmm(config.get("block_end") or "00:00", "Lockout window end")
    return config


async def compute_lockout(
    db: AsyncSession, config: dict, now: datetime | None = None
) -> LockoutPlan:
    """Work out which kids' devices should be offline right now.

    ``now`` is *local* time (``datetime.now()``) — the window and "today"
    are family calendar concepts, never UTC.
    """
    from backend.routers.vacation import is_vacation_day

    now = now or datetime.now()
    today: date = now.date()
    devices = clean_devices(config.get("devices"))
    start = parse_hhmm(config.get("block_start") or "00:00", "Lockout window start")
    end = parse_hhmm(config.get("block_end") or "00:00", "Lockout window end")
    window_open = in_window(now.time(), start, end)

    blocking = [AssignmentStatus.pending]
    if config.get("unlock_on") == UNLOCK_ON_VERIFIED:
        blocking.append(AssignmentStatus.completed)

    kids = (
        await db.execute(
            select(User).where(User.role == UserRole.kid, User.is_active == True)
            .order_by(User.display_name)
        )
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

    plan = LockoutPlan()
    for kid in kids:
        ips = devices.get(str(kid.id), [])
        outstanding = counts.get(kid.id, 0)
        if not ips:
            blocked, reason = False, "No devices configured"
        elif not window_open:
            blocked, reason = False, "Outside lockout window"
        elif await is_vacation_day(db, today, user_id=kid.id):
            blocked, reason = False, "On vacation"
        elif outstanding:
            blocked = True
            waiting = "approval" if config.get("unlock_on") == UNLOCK_ON_VERIFIED else "submission"
            reason = f"{outstanding} quest{'s' if outstanding != 1 else ''} awaiting {waiting}"
        else:
            blocked, reason = False, "All quests done"
        plan.kids.append(KidLockout(kid.id, kid.display_name, ips, blocked, reason, outstanding))
    return plan


class InternetLockoutPlugin(Plugin):
    """Base for router plugins: block kids' devices until quests are done."""

    category = "Internet control"
    router_fields: list[ConfigField] = []

    @property
    def fields(self) -> list[ConfigField]:  # type: ignore[override]
        return self.router_fields + LOCKOUT_FIELDS

    def validate(self, config: dict) -> dict:
        return validate_lockout_config(super().validate(config))

    async def apply_blocklist(self, config: dict, entries: list[tuple[str, str]]) -> str:
        """Make the router block exactly ``entries`` (ip, description).

        Return a short summary of what changed. Must be idempotent.
        """
        raise NotImplementedError

    async def sync(self, db: AsyncSession, config: dict) -> dict:
        plan = await compute_lockout(db, config)
        entries = plan.blocked_entries
        message = await self.apply_blocklist(config, entries)
        return {"message": message, "details": {"kids": [k.to_dict() for k in plan.kids]}}

    async def disable(self, config: dict) -> None:
        await self.apply_blocklist(config, [])
