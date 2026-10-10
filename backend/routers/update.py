"""
In-app update management.

GET  /api/admin/update/check   — compare current build vs latest GitHub commit
GET  /api/admin/update/status  — host watchdog heartbeat + last deploy result
POST /api/admin/update/trigger — write a flag file that the host watchdog picks up

Architecture note: the container cannot rebuild itself (the frontend is baked in at
image-build time). Triggering an update writes /app/data/.update_requested; the
host-side watchdog.sh detects that file and runs deploy.sh outside the container.
"""

import asyncio
import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.dependencies import require_admin, require_parent
from backend.models import User
from backend.websocket_manager import ws_manager

router = APIRouter(prefix="/api/admin/update", tags=["update"])

GITHUB_REPO = os.environ.get("GITHUB_REPO", "turbogizzmo/ChoreQuest")
DATA_DIR = Path("/app/data")
FLAG_FILE = DATA_DIR / ".update_requested"
HEARTBEAT_FILE = DATA_DIR / ".watchdog_heartbeat"
LOCK_FILE = DATA_DIR / ".update_in_progress"
STATUS_FILE = DATA_DIR / ".update_status.json"
# watchdog.sh beats every 30s (daemon) or 60s (cron); allow a few misses.
HEARTBEAT_STALE_SECONDS = 5 * 60


def _watchdog_status(data_dir: Path | None = None) -> dict:
    """Report what the host watchdog has written to the shared data volume.

    ``alive`` is None when no heartbeat file exists — older watchdog.sh
    versions don't write one, so "unknown" rather than "down".
    """
    d = data_dir or DATA_DIR
    now = datetime.now(timezone.utc)

    last_seen = None
    alive = None
    heartbeat = d / HEARTBEAT_FILE.name
    if heartbeat.exists():
        mtime = datetime.fromtimestamp(heartbeat.stat().st_mtime, tz=timezone.utc)
        last_seen = mtime.isoformat()
        alive = (now - mtime).total_seconds() < HEARTBEAT_STALE_SECONDS

    last_update = None
    status_file = d / STATUS_FILE.name
    if status_file.exists():
        try:
            last_update = json.loads(status_file.read_text())
        except (OSError, ValueError):
            last_update = None

    flag = d / FLAG_FILE.name
    pending_since = None
    if flag.exists():
        pending_since = datetime.fromtimestamp(flag.stat().st_mtime, tz=timezone.utc).isoformat()

    return {
        "alive": alive,
        "last_seen": last_seen,
        "update_pending_since": pending_since,
        "deploy_in_progress": (d / LOCK_FILE.name).exists(),
        "last_update": last_update,
    }


def _fetch_latest_commit() -> dict:
    """Synchronous GitHub API call — run via asyncio.to_thread."""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/commits/main"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "ChoreQuest-UpdateCheck/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GitHub API error {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: {e.reason}")


@router.get("/check")
async def check_for_updates(_: User = Depends(require_parent)):
    """
    Compare the running GIT_COMMIT env var against the latest commit on main.
    Accessible to parents and admins (read-only check).
    """
    current = os.environ.get("GIT_COMMIT", "unknown")

    if current == "unknown":
        return {
            "current": "unknown",
            "latest": None,
            "update_available": False,
            "message": "Version tracking not available (dev/local build)",
            "watchdog": _watchdog_status(),
        }

    try:
        data = await asyncio.to_thread(_fetch_latest_commit)
    except RuntimeError as e:
        raise HTTPException(502, detail=str(e))

    latest_sha = data["sha"]
    latest_short = latest_sha[:7]
    commit_info = data.get("commit", {})
    commit_msg = commit_info.get("message", "").split("\n")[0]
    commit_date = commit_info.get("committer", {}).get("date") or commit_info.get("author", {}).get("date")
    author = commit_info.get("author", {}).get("name", "unknown")

    # Current GIT_COMMIT is the short hash (7 chars); latest is the full 40-char SHA.
    update_available = not latest_sha.startswith(current)

    return {
        "current": current,
        "latest": latest_short,
        "latest_full": latest_sha,
        "update_available": update_available,
        "commit_message": commit_msg,
        "commit_date": commit_date,
        "commit_author": author,
        "watchdog": _watchdog_status(),
    }


@router.get("/status")
async def watchdog_status(_: User = Depends(require_parent)):
    """Host watchdog health + last deploy result (local files only, no GitHub call)."""
    return _watchdog_status()


@router.post("/trigger")
async def trigger_update(admin: User = Depends(require_admin)):
    """
    Request an update by writing a flag file to the data volume.
    The host-side watchdog.sh picks this up and runs deploy.sh.
    Admin-only.
    """
    # Broadcast FIRST so all connected clients show the overlay before the
    # container starts shutting down.  Writing the flag file afterwards (with
    # a short delay) gives WebSocket messages time to reach every device.
    current_version = os.environ.get("GIT_COMMIT", "unknown")
    await ws_manager.broadcast({
        "type": "update_triggered",
        "version": current_version,
    })

    # Small pause — lets the WS frames be flushed to all clients before the
    # watchdog picks up the flag file and begins the container restart.
    await asyncio.sleep(1.5)

    try:
        FLAG_FILE.parent.mkdir(parents=True, exist_ok=True)
        FLAG_FILE.touch(exist_ok=True)
    except OSError as e:
        raise HTTPException(500, detail=f"Could not write update flag: {e}")

    return {
        "status": "ok",
        "message": "Update requested. The watchdog will pull and restart the container shortly.",
    }
