"""
In-app update management.

GET  /api/admin/update/check   — compare current build vs latest GitHub commit
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
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.dependencies import require_admin, require_parent
from backend.models import User

router = APIRouter(prefix="/api/admin/update", tags=["update"])

GITHUB_REPO = os.environ.get("GITHUB_REPO", "turbogizzmo/ChoreQuest")
FLAG_FILE = Path("/app/data/.update_requested")


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
    }


@router.post("/trigger")
async def trigger_update(admin: User = Depends(require_admin)):
    """
    Request an update by writing a flag file to the data volume.
    The host-side watchdog.sh picks this up and runs deploy.sh.
    Admin-only.
    """
    try:
        FLAG_FILE.parent.mkdir(parents=True, exist_ok=True)
        FLAG_FILE.touch(exist_ok=True)
    except OSError as e:
        raise HTTPException(500, detail=f"Could not write update flag: {e}")

    return {
        "status": "ok",
        "message": "Update requested. The watchdog will pull and restart the container shortly.",
    }
