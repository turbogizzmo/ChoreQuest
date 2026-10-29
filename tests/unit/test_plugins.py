"""Tests for the plugin framework and the pfSense internet-lockout plugin."""

import json
from datetime import date, datetime, time

import pytest
from sqlalchemy import select

from backend.models import AppSetting, AssignmentStatus, ChoreAssignment, UserRole, VacationPeriod
from backend.plugins import PLUGINS, PluginError
from backend.plugins import manager
from backend.plugins.internet_lockout import (
    clean_groups, compute_lockout, in_window, parse_address,
)
from backend.plugins.pfsense import RULE_APP, RULE_BLOCK, RULE_DNS, PfSenseClient, PfSensePlugin
from backend.routers.plugins import _merge
from tests.unit.conftest import make_category, make_chore, make_user

TODAY = date(2026, 3, 10)
NOON = datetime(2026, 3, 10, 12, 0)


async def _family(db):
    parent = await make_user(db, "parent", UserRole.parent)
    kid = await make_user(db, "alice")
    cat = await make_category(db)
    chore = await make_chore(db, parent.id, cat.id)
    return parent, kid, chore


def _assign(db, chore, kid, status=AssignmentStatus.pending, day=TODAY):
    db.add(ChoreAssignment(chore_id=chore.id, user_id=kid.id, date=day, status=status))


def _group(name, kid_ids, *addresses):
    return {"name": name, "kid_ids": kid_ids,
            "devices": [{"name": f"dev{i}", "address": a} for i, a in enumerate(addresses)]}


def _config(kid, **overrides):
    config = {"groups": [_group("Alice", [kid.id], "192.168.1.50")], "unlock_on": "submitted",
              "block_start": "00:00", "block_end": "00:00"}
    config.update(overrides)
    return config


def _blocked(plan):
    return [address for address, _ in plan.blocked_devices]


# ---------------------------------------------------------------------------
# Device addresses and groups
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("192.168.1.5", ("ip", "192.168.1.5")),
    (" fe80::1 ", ("ip", "fe80::1")),
    ("AA:BB:CC:DD:EE:FF", ("mac", "aa:bb:cc:dd:ee:ff")),
    ("aa-bb-cc-dd-ee-ff", ("mac", "aa:bb:cc:dd:ee:ff")),
    ("aabb.ccdd.eeff", ("mac", "aa:bb:cc:dd:ee:ff")),
    ("Alices-iPad", ("name", "alices-ipad")),
    ("xbox.home.lan.", ("name", "xbox.home.lan")),
])
def test_parse_address_detects_kind(raw, expected):
    assert parse_address(raw) == expected


@pytest.mark.parametrize("raw", ["", "not a device!", "aa:bb:cc:dd:ee", "-bad"])
def test_parse_address_rejects_junk(raw):
    with pytest.raises(PluginError):
        parse_address(raw)


def test_clean_groups_normalises_skips_blanks_and_dedupes():
    groups = clean_groups([{
        "name": "  ", "kid_ids": ["3", 3],
        "devices": [{"name": "iPad", "address": "AA-BB-CC-DD-EE-FF"},
                    {"name": "dupe", "address": "aa:bb:cc:dd:ee:ff"},
                    {"name": "", "address": "  "}],
    }])
    assert groups[0]["name"] == "Group 1"
    assert groups[0]["kid_ids"] == [3]
    assert groups[0]["id"]
    assert groups[0]["devices"] == [{"name": "iPad", "address": "aa:bb:cc:dd:ee:ff", "kind": "mac"}]


def test_clean_groups_names_the_group_in_errors():
    with pytest.raises(PluginError, match="Alice"):
        clean_groups([_group("Alice", [1], "nope nope")])


# ---------------------------------------------------------------------------
# Who gets locked out
# ---------------------------------------------------------------------------

async def test_pending_quest_blocks_group(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    plan = await compute_lockout(db, _config(kid), NOON)
    assert plan.blocked_devices == [("192.168.1.50", "ChoreQuest: Alice - dev0")]


async def test_submitted_quest_unblocks_in_submitted_mode(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid, AssignmentStatus.completed)
    await db.flush()

    assert _blocked(await compute_lockout(db, _config(kid), NOON)) == []


async def test_submitted_quest_still_blocks_in_verified_mode(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid, AssignmentStatus.completed)
    await db.flush()

    plan = await compute_lockout(db, _config(kid, unlock_on="verified"), NOON)
    assert _blocked(plan) == ["192.168.1.50"]


async def test_verified_and_skipped_quests_never_block(db):
    parent, kid, chore = await _family(db)
    other = await make_chore(db, parent.id, chore.category_id, title="Other")
    _assign(db, chore, kid, AssignmentStatus.verified)
    _assign(db, other, kid, AssignmentStatus.skipped)
    await db.flush()

    assert _blocked(await compute_lockout(db, _config(kid, unlock_on="verified"), NOON)) == []


async def test_yesterdays_and_bounty_quests_do_not_block(db):
    parent, kid, chore = await _family(db)
    bounty = await make_chore(db, parent.id, chore.category_id, title="Bounty")
    bounty.is_bounty = True
    _assign(db, chore, kid, day=date(2026, 3, 9))
    _assign(db, bounty, kid)
    await db.flush()

    assert _blocked(await compute_lockout(db, _config(kid), NOON)) == []


async def test_vacation_day_unblocks(db):
    parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    db.add(VacationPeriod(start_date=TODAY, end_date=TODAY, created_by=parent.id, user_id=kid.id))
    await db.flush()

    plan = await compute_lockout(db, _config(kid), NOON)
    assert _blocked(plan) == []
    assert "vacation" in plan.groups[0].reason


async def test_outside_window_unblocks(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    config = _config(kid, block_start="15:00", block_end="21:00")
    assert _blocked(await compute_lockout(db, config, NOON)) == []
    evening = datetime(2026, 3, 10, 18, 0)
    assert _blocked(await compute_lockout(db, config, evening)) == ["192.168.1.50"]


async def test_shared_group_waits_for_every_kid(db):
    parent, alice, chore = await _family(db)
    bob = await make_user(db, "bob")
    _assign(db, chore, alice, AssignmentStatus.completed)
    _assign(db, chore, bob)
    await db.flush()

    config = _config(alice, groups=[
        _group("Alice", [alice.id], "10.0.0.1"),
        _group("Living room TV", [alice.id, bob.id], "10.0.0.9"),
    ])
    plan = await compute_lockout(db, config, NOON)
    assert _blocked(plan) == ["10.0.0.9"]
    assert plan.groups[1].reason.startswith("bob:")


async def test_group_without_kids_is_never_blocked(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    plan = await compute_lockout(db, _config(kid, groups=[_group("Spare", [], "10.0.0.2")]), NOON)
    assert _blocked(plan) == []
    assert plan.groups[0].reason == "No kids picked for this group"


def test_in_window_handles_all_day_and_midnight_crossing():
    assert in_window(time(3, 0), time(0, 0), time(0, 0))
    assert in_window(time(23, 0), time(20, 0), time(2, 0))
    assert in_window(time(1, 0), time(20, 0), time(2, 0))
    assert not in_window(time(12, 0), time(20, 0), time(2, 0))


# ---------------------------------------------------------------------------
# pfSense API calls
# ---------------------------------------------------------------------------

class FakePfSense:
    """Stands in for PfSenseClient._request_sync and records calls."""

    def __init__(self, alias=None, leases=(), arp=(), rules=()):
        self.alias = alias
        self.leases = list(leases)
        self.arp = list(arp)
        self.rules = list(rules)
        self.calls = []

    def request(self, method, path, *, query=None, body=None):
        self.calls.append((method, path, query, body))
        if method == "GET" and path == "/api/v2/firewall/aliases":
            return [self.alias] if self.alias else []
        if method == "GET" and path == "/api/v2/status/dhcp_server/leases":
            return self.leases
        if method == "GET" and path == "/api/v2/diagnostics/arp_table":
            return self.arp
        if method == "GET" and path == "/api/v2/firewall/rules":
            return self.rules
        if method == "POST" and path == "/api/v2/firewall/alias":
            self.alias = {**body, "id": 0}
        if path == "/api/v2/firewall/rule" and method in ("POST", "PATCH"):
            rule = {k: v for k, v in body.items() if k != "placement"}
            self.rules = [r for r in self.rules if r["descr"] != rule["descr"]]
            self.rules.insert(0, {**rule, "id": len(self.rules)})
        return {}

    def methods(self):
        return [(m, p) for m, p, _q, _b in self.calls]


@pytest.fixture
def fake_pfsense(monkeypatch):
    def install(**kwargs):
        fake = FakePfSense(**kwargs)
        monkeypatch.setattr(
            PfSenseClient, "_request_sync", lambda _client, *a, **kw: fake.request(*a, **kw)
        )
        return fake
    return install


PF_CONFIG = {"base_url": "https://fw.lan", "api_key": "k", "verify_tls": False,
             "alias_name": "ChoreQuest_Blocked", "kill_states": True, "interface": "lan",
             "chorequest_address": "192.168.1.10"}
ALIAS = {"id": 2, "name": "ChoreQuest_Blocked", "type": "host", "address": ["192.168.1.50"]}


async def test_creates_alias_when_missing(fake_pfsense):
    fake = fake_pfsense()
    await PfSensePlugin().apply_blocklist(PF_CONFIG, [("192.168.1.50", "ChoreQuest: alice")])

    body = next(b for m, _p, _q, b in fake.calls if m == "POST")
    assert body["type"] == "host" and body["address"] == ["192.168.1.50"] and body["apply"]
    assert ("DELETE", "/api/v2/firewall/states") in fake.methods()


async def test_unchanged_alias_is_not_rewritten(fake_pfsense):
    fake = fake_pfsense(alias=dict(ALIAS))
    await PfSensePlugin().apply_blocklist(PF_CONFIG, [("192.168.1.50", "x")])
    assert [m for m, *_ in fake.calls] == ["GET"]


async def test_changed_alias_is_patched_and_only_new_ips_are_cut_off(fake_pfsense):
    fake = fake_pfsense(alias=dict(ALIAS))
    await PfSensePlugin().apply_blocklist(
        PF_CONFIG, [("192.168.1.50", "a"), ("192.168.1.51", "b"), ("xbox.home.lan", "c")]
    )
    patch = next(b for m, _p, _q, b in fake.calls if m == "PATCH")
    assert patch["id"] == 2 and patch["address"] == ["192.168.1.50", "192.168.1.51", "xbox.home.lan"]
    kills = [q for m, _p, q, _b in fake.calls if m == "DELETE"]
    assert kills == [{"source__startswith": "192.168.1.51:"}]


async def test_disable_empties_alias(fake_pfsense):
    fake = fake_pfsense(alias=dict(ALIAS))
    await PfSensePlugin().disable(PF_CONFIG)
    patch = next(b for m, _p, _q, b in fake.calls if m == "PATCH")
    assert patch["address"] == []


async def test_refuses_to_touch_non_host_alias(fake_pfsense):
    fake_pfsense(alias={**ALIAS, "type": "network"})
    with pytest.raises(PluginError):
        await PfSensePlugin().apply_blocklist(PF_CONFIG, [])


LEASES = [
    {"ip": "192.168.1.23", "mac": "AA:BB:CC:00:00:01", "hostname": "Alices-iPad",
     "descr": "", "active_status": "active", "online_status": "online"},
    {"ip": "192.168.1.99", "mac": "aa:bb:cc:00:00:01", "hostname": "Alices-iPad",
     "active_status": "expired", "online_status": "offline"},
    {"ip": "192.168.1.30", "mac": "aa:bb:cc:00:00:02", "hostname": "",
     "descr": "Living room TV", "active_status": "static", "online_status": "offline"},
]
ARP = [{"ip_address": "192.168.1.40", "mac_address": "aa:bb:cc:00:00:03", "hostname": "?"}]


async def test_resolves_mac_and_names_from_leases_and_arp(fake_pfsense):
    fake_pfsense(leases=LEASES, arp=ARP)
    devices = [
        {"address": "aa:bb:cc:00:00:01", "kind": "mac"},
        {"address": "aa:bb:cc:00:00:03", "kind": "mac"},
        {"address": "aa:bb:cc:00:00:09", "kind": "mac"},
        {"address": "alices-ipad.home.lan", "kind": "name"},
        {"address": "xbox.home.lan", "kind": "name"},
        {"address": "ghost", "kind": "name"},
        {"address": "10.0.0.5", "kind": "ip"},
    ]
    r = await PfSensePlugin().resolve_addresses(PF_CONFIG, devices)

    assert r["aa:bb:cc:00:00:01"].targets == ["192.168.1.23"]  # expired lease ignored
    assert r["aa:bb:cc:00:00:03"].targets == ["192.168.1.40"]  # from ARP
    assert r["aa:bb:cc:00:00:09"].targets == [] and r["aa:bb:cc:00:00:09"].note
    assert r["alices-ipad.home.lan"].targets == ["192.168.1.23"]  # short-name match
    assert r["xbox.home.lan"].targets == ["xbox.home.lan"]  # FQDN handed to pfSense
    assert r["ghost"].targets == [] and r["ghost"].note
    assert r["10.0.0.5"].targets == ["10.0.0.5"]


async def test_ip_only_groups_do_not_query_leases(fake_pfsense):
    fake = fake_pfsense()
    await PfSensePlugin().resolve_addresses(PF_CONFIG, [{"address": "10.0.0.5", "kind": "ip"}])
    assert fake.calls == []


async def test_network_device_list_merges_sources(fake_pfsense):
    fake_pfsense(leases=LEASES, arp=ARP)
    devices = await PfSensePlugin().list_network_devices(PF_CONFIG)
    by_mac = {d["mac"]: d for d in devices}
    assert by_mac["aa:bb:cc:00:00:01"] == {"name": "Alices-iPad", "ip": "192.168.1.23",
                                         "mac": "aa:bb:cc:00:00:01", "hostname": "Alices-iPad",
                                         "online": True}
    assert by_mac["aa:bb:cc:00:00:02"]["name"] == "Living room TV"
    assert by_mac["aa:bb:cc:00:00:02"]["hostname"] == ""  # a description, not a network name
    assert by_mac["aa:bb:cc:00:00:03"]["online"] is True
    assert devices[-1]["mac"] == "aa:bb:cc:00:00:02"  # offline devices last


async def test_setup_rules_creates_three_rules_in_order(fake_pfsense):
    fake = fake_pfsense()
    await PfSensePlugin().run_action("setup_rules", PF_CONFIG)

    assert [r["descr"] for r in fake.rules] == [RULE_DNS, RULE_APP, RULE_BLOCK]
    assert fake.rules[1]["destination"] == "192.168.1.10"
    assert fake.rules[2]["type"] == "reject" and fake.rules[2]["source"] == "ChoreQuest_Blocked"
    assert fake.alias is not None  # alias created before rules reference it
    assert fake.methods()[-1] == ("POST", "/api/v2/firewall/apply")


async def test_setup_rules_twice_does_not_duplicate(fake_pfsense):
    fake = fake_pfsense()
    plugin = PfSensePlugin()
    await plugin.run_action("setup_rules", PF_CONFIG)
    await plugin.run_action("setup_rules", {**PF_CONFIG, "chorequest_address": "192.168.1.11"})
    assert [r["descr"] for r in fake.rules] == [RULE_DNS, RULE_APP, RULE_BLOCK]
    assert fake.rules[1]["destination"] == "192.168.1.11"


async def test_setup_rules_needs_chorequest_address(fake_pfsense):
    fake_pfsense()
    with pytest.raises(PluginError, match="ChoreQuest server IP"):
        await PfSensePlugin().run_action("setup_rules", {**PF_CONFIG, "chorequest_address": ""})


async def test_missing_rules_are_reported_as_a_warning(fake_pfsense):
    fake_pfsense()
    assert await PfSensePlugin().health_warnings(PF_CONFIG)
    fake_pfsense(rules=[{"descr": RULE_BLOCK, "id": 0}])
    assert await PfSensePlugin().health_warnings(PF_CONFIG) == []


def test_validate_fills_scheme_and_rejects_bad_values():
    plugin = PfSensePlugin()
    assert plugin.validate({**PF_CONFIG, "base_url": "192.168.1.1"})["base_url"] == "https://192.168.1.1"
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "alias_name": "has space"})
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "api_key": ""})
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "chorequest_address": "chorequest.lan"})


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

async def test_plugins_are_disabled_by_default(db):
    for plugin in PLUGINS.values():
        enabled, _config = await manager.load_plugin(db, plugin)
        assert enabled is False


async def test_secrets_are_encrypted_at_rest(db):
    plugin = PLUGINS["pfsense"]
    await manager.save_plugin(db, plugin, True, {**PF_CONFIG, "api_key": "super-secret"})
    await db.flush()

    row = (await db.execute(select(AppSetting).where(AppSetting.key == "plugin.pfsense"))).scalar_one()
    assert "super-secret" not in row.value
    assert json.loads(row.value)["config"]["api_key"].startswith("enc2:")

    enabled, config = await manager.load_plugin(db, plugin)
    assert enabled and config["api_key"] == "super-secret"


def test_blank_secret_keeps_saved_value_and_unknown_keys_dropped():
    plugin = PLUGINS["pfsense"]
    merged = _merge(plugin, {"api_key": "saved", "base_url": "https://x"},
                    {"api_key": "", "base_url": "https://x", "evil": 1})
    assert merged["api_key"] == "saved"
    assert "evil" not in merged


def test_saved_secret_is_not_reused_for_a_different_host():
    plugin = PLUGINS["pfsense"]
    saved = {"api_key": "saved", "base_url": "https://fw.lan"}
    assert _merge(plugin, saved, {"base_url": "https://evil.example"})["api_key"] == ""
    assert _merge(plugin, saved, {"base_url": "https://fw.lan"})["api_key"] == "saved"
    assert _merge(plugin, saved, {"base_url": "https://new.lan", "api_key": "k2"})["api_key"] == "k2"
