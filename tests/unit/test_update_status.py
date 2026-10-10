"""Unit tests for the host-watchdog status reported to Settings."""

import json
import os
import time

from backend.routers.update import _watchdog_status


def test_no_files_means_unknown(tmp_path):
    status = _watchdog_status(tmp_path)
    assert status["alive"] is None
    assert status["last_update"] is None
    assert status["update_pending_since"] is None
    assert status["deploy_in_progress"] is False


def test_fresh_heartbeat_is_alive(tmp_path):
    (tmp_path / ".watchdog_heartbeat").write_text("now")
    assert _watchdog_status(tmp_path)["alive"] is True


def test_old_heartbeat_is_down(tmp_path):
    hb = tmp_path / ".watchdog_heartbeat"
    hb.write_text("old")
    old = time.time() - 3600
    os.utime(hb, (old, old))
    assert _watchdog_status(tmp_path)["alive"] is False


def test_reports_last_update_and_pending_flag(tmp_path):
    (tmp_path / ".update_status.json").write_text(json.dumps(
        {"state": "failed", "message": "git pull failed", "updated_at": "2026-10-10T00:00:00Z"}
    ))
    (tmp_path / ".update_requested").touch()
    (tmp_path / ".update_in_progress").write_text("123")
    status = _watchdog_status(tmp_path)
    assert status["last_update"]["state"] == "failed"
    assert status["update_pending_since"] is not None
    assert status["deploy_in_progress"] is True


def test_corrupt_status_file_is_ignored(tmp_path):
    (tmp_path / ".update_status.json").write_text("{not json")
    assert _watchdog_status(tmp_path)["last_update"] is None
