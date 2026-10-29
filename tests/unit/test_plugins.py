"""Tests for the plugin framework and the pfSense internet-lockout plugin."""

import json
from datetime import date, datetime, time

import pytest
from sqlalchemy import select

from backend.models import AppSetting, AssignmentStatus, ChoreAssignment, UserRole, VacationPeriod
from backend.plugins import PLUGINS, PluginError
from backend.plugins import manager
from backend.plugins.internet_lockout import clean_devices, compute_lockout, in_window
from backend.plugins.pfsense import PfSenseClient, PfSensePlugin
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


def _config(kid, **overrides):
    config = {"devices": {str(kid.id): ["192.168.1.50"]}, "unlock_on": "submitted",
              "block_start": "00:00", "block_end": "00:00"}
    config.update(overrides)
    return config


# ---------------------------------------------------------------------------
# Who gets locked out
# ---------------------------------------------------------------------------

async def test_pending_quest_blocks_kid(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    plan = await compute_lockout(db, _config(kid), NOON)

    assert plan.blocked_entries == [("192.168.1.50", "ChoreQuest: alice")]
    assert plan.kids[0].outstanding == 1


async def test_submitted_quest_unblocks_in_submitted_mode(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid, AssignmentStatus.completed)
    await db.flush()

    assert (await compute_lockout(db, _config(kid), NOON)).blocked_entries == []


async def test_submitted_quest_still_blocks_in_verified_mode(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid, AssignmentStatus.completed)
    await db.flush()

    plan = await compute_lockout(db, _config(kid, unlock_on="verified"), NOON)
    assert [ip for ip, _ in plan.blocked_entries] == ["192.168.1.50"]


async def test_verified_and_skipped_quests_never_block(db):
    parent, kid, chore = await _family(db)
    other = await make_chore(db, parent.id, chore.category_id, title="Other")
    _assign(db, chore, kid, AssignmentStatus.verified)
    _assign(db, other, kid, AssignmentStatus.skipped)
    await db.flush()

    plan = await compute_lockout(db, _config(kid, unlock_on="verified"), NOON)
    assert plan.blocked_entries == []


async def test_yesterdays_and_bounty_quests_do_not_block(db):
    parent, kid, chore = await _family(db)
    bounty = await make_chore(db, parent.id, chore.category_id, title="Bounty")
    bounty.is_bounty = True
    _assign(db, chore, kid, day=date(2026, 3, 9))
    _assign(db, bounty, kid)
    await db.flush()

    assert (await compute_lockout(db, _config(kid), NOON)).blocked_entries == []


async def test_vacation_day_unblocks(db):
    parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    db.add(VacationPeriod(start_date=TODAY, end_date=TODAY, created_by=parent.id, user_id=kid.id))
    await db.flush()

    plan = await compute_lockout(db, _config(kid), NOON)
    assert plan.blocked_entries == []
    assert plan.kids[0].reason == "On vacation"


async def test_outside_window_unblocks(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    config = _config(kid, block_start="15:00", block_end="21:00")
    assert (await compute_lockout(db, config, NOON)).blocked_entries == []
    evening = datetime(2026, 3, 10, 18, 0)
    assert len((await compute_lockout(db, config, evening)).blocked_entries) == 1


async def test_kid_without_devices_is_never_blocked(db):
    _parent, kid, chore = await _family(db)
    _assign(db, chore, kid)
    await db.flush()

    plan = await compute_lockout(db, _config(kid, devices={}), NOON)
    assert plan.blocked_entries == []
    assert plan.kids[0].reason == "No devices configured"


def test_in_window_handles_all_day_and_midnight_crossing():
    assert in_window(time(3, 0), time(0, 0), time(0, 0))
    assert in_window(time(23, 0), time(20, 0), time(2, 0))
    assert in_window(time(1, 0), time(20, 0), time(2, 0))
    assert not in_window(time(12, 0), time(20, 0), time(2, 0))


def test_clean_devices_normalises_and_rejects_bad_ips():
    assert clean_devices({"3": "192.168.1.5, 192.168.1.5 10.0.0.2"}) == {
        "3": ["192.168.1.5", "10.0.0.2"]
    }
    assert clean_devices({"4": []}) == {}
    with pytest.raises(PluginError):
        clean_devices({"3": ["not-an-ip"]})


# ---------------------------------------------------------------------------
# pfSense API calls
# ---------------------------------------------------------------------------

class FakePfSense:
    """Stands in for PfSenseClient._request_sync and records calls."""

    def __init__(self, alias=None):
        self.alias = alias
        self.calls = []

    def request(self, method, path, *, query=None, body=None):
        self.calls.append((method, path, query, body))
        if method == "GET":
            return [self.alias] if self.alias else []
        return {}


@pytest.fixture
def fake_pfsense(monkeypatch):
    def install(alias=None):
        fake = FakePfSense(alias)
        monkeypatch.setattr(
            PfSenseClient, "_request_sync", lambda _client, *a, **kw: fake.request(*a, **kw)
        )
        return fake
    return install


PF_CONFIG = {"base_url": "https://fw.lan", "api_key": "k", "verify_tls": True,
             "alias_name": "ChoreQuest_Blocked", "kill_states": True}


async def test_creates_alias_when_missing(fake_pfsense):
    fake = fake_pfsense(None)
    await PfSensePlugin().apply_blocklist(PF_CONFIG, [("192.168.1.50", "ChoreQuest: alice")])

    methods = [(m, p) for m, p, _q, _b in fake.calls]
    assert ("POST", "/api/v2/firewall/alias") in methods
    body = next(b for m, _p, _q, b in fake.calls if m == "POST")
    assert body["type"] == "host" and body["address"] == ["192.168.1.50"] and body["apply"]
    assert ("DELETE", "/api/v2/firewall/states") in methods


async def test_unchanged_alias_is_not_rewritten(fake_pfsense):
    fake = fake_pfsense({"id": 2, "name": "ChoreQuest_Blocked", "type": "host",
                         "address": ["192.168.1.50"]})
    await PfSensePlugin().apply_blocklist(PF_CONFIG, [("192.168.1.50", "x")])
    assert [m for m, *_ in fake.calls] == ["GET"]


async def test_changed_alias_is_patched_and_only_new_ips_are_cut_off(fake_pfsense):
    fake = fake_pfsense({"id": 2, "name": "ChoreQuest_Blocked", "type": "host",
                         "address": ["192.168.1.50"]})
    await PfSensePlugin().apply_blocklist(
        PF_CONFIG, [("192.168.1.50", "a"), ("192.168.1.51", "b")]
    )
    patch = next(b for m, _p, _q, b in fake.calls if m == "PATCH")
    assert patch["id"] == 2 and patch["address"] == ["192.168.1.50", "192.168.1.51"]
    kills = [q for m, _p, q, _b in fake.calls if m == "DELETE"]
    assert kills == [{"source__startswith": "192.168.1.51:"}]


async def test_disable_empties_alias(fake_pfsense):
    fake = fake_pfsense({"id": 2, "name": "ChoreQuest_Blocked", "type": "host",
                         "address": ["192.168.1.50"]})
    await PfSensePlugin().disable(PF_CONFIG)
    patch = next(b for m, _p, _q, b in fake.calls if m == "PATCH")
    assert patch["address"] == []


async def test_refuses_to_touch_non_host_alias(fake_pfsense):
    fake_pfsense({"id": 2, "name": "ChoreQuest_Blocked", "type": "network", "address": []})
    with pytest.raises(PluginError):
        await PfSensePlugin().apply_blocklist(PF_CONFIG, [])


def test_validate_rejects_bad_url_and_alias():
    plugin = PfSensePlugin()
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "base_url": "fw.lan"})
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "alias_name": "has space"})
    with pytest.raises(PluginError):
        plugin.validate({**PF_CONFIG, "api_key": ""})


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
