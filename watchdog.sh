#!/bin/bash
# watchdog.sh — monitors for in-app update requests and runs deploy.sh
#
# Recommended: run it every minute from cron / Synology Task Scheduler. Cron
# mode survives reboots and always runs the latest copy of this script:
#   * * * * * /bin/bash /path/to/ChoreQuest/watchdog.sh --cron >> /path/to/ChoreQuest/data/watchdog.log 2>&1
#
# Or run it as a long-lived daemon (must be restarted after every reboot):
#   nohup bash /path/to/ChoreQuest/watchdog.sh >> /path/to/ChoreQuest/data/watchdog.log 2>&1 &
#
# How it works:
#   1. The ChoreQuest app writes /app/data/.update_requested when an admin
#      clicks "Apply Update" in Settings.
#   2. This script detects that file (it's in the ./data/ folder on the host),
#      removes it, and runs deploy.sh to git pull + rebuild + restart.
#   3. It writes ./data/.watchdog_heartbeat on every check and
#      ./data/.update_status.json after every deploy, so Settings can show
#      whether the watchdog is alive and why the last update failed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
FLAG_FILE="$DATA_DIR/.update_requested"
LOCK_FILE="$DATA_DIR/.update_in_progress"
HEARTBEAT_FILE="$DATA_DIR/.watchdog_heartbeat"
STATUS_FILE="$DATA_DIR/.update_status.json"
DEPLOY_LOG="$DATA_DIR/deploy.log"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
# A deploy (git pull + no-cache build) should never take this long; a lock
# older than this is left over from an interrupted run (reboot, killed shell).
STALE_LOCK_MINUTES=60
CRON_MODE=false

[[ "${1:-}" == "--cron" ]] && CRON_MODE=true

mkdir -p "$DATA_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

heartbeat() {
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$HEARTBEAT_FILE"
}

# json_escape <string> — minimal escaping for the status file (no jq on NAS boxes)
json_escape() {
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

write_status() {  # write_status <state> <message>
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '{"state":"%s","message":"%s","updated_at":"%s"}\n' \
    "$1" "$(json_escape "$2")" "$now" > "$STATUS_FILE.tmp" && mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# Returns 0 (true) if the lock is held by a live deploy, else clears it.
lock_is_active() {
  [ -f "$LOCK_FILE" ] || return 1
  local pid
  pid="$(cat "$LOCK_FILE" 2>/dev/null)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  # Legacy empty lock files have no PID — fall back to age.
  if [ -z "$pid" ] && [ -z "$(find "$LOCK_FILE" -mmin +"$STALE_LOCK_MINUTES" 2>/dev/null)" ]; then
    return 0
  fi
  log "Removing stale lock (pid '${pid:-none}' is not running)."
  rm -f "$LOCK_FILE"
  return 1
}

deploy() {
  if lock_is_active; then
    log "Deploy already in progress, skipping."
    return
  fi

  log "Update flag detected. Starting deploy..."
  echo $$ > "$LOCK_FILE"
  rm -f "$FLAG_FILE"
  write_status "running" "Pulling latest code and rebuilding…"

  {
    echo "===== Deploy started $(date '+%Y-%m-%d %H:%M:%S') ====="
  } > "$DEPLOY_LOG"

  if bash "$DEPLOY_SCRIPT" >> "$DEPLOY_LOG" 2>&1; then
    log "Deploy completed successfully."
    write_status "success" "$(tail -n 1 "$DEPLOY_LOG")"
  else
    local rc=$?
    log "ERROR: Deploy script exited with code $rc. Last output:"
    tail -n 15 "$DEPLOY_LOG" | sed 's/^/    /'
    write_status "failed" "$(tail -n 6 "$DEPLOY_LOG")"
  fi
  cat "$DEPLOY_LOG" >> "$DATA_DIR/deploy-history.log" 2>/dev/null

  rm -f "$LOCK_FILE"
}

if $CRON_MODE; then
  # Single-shot mode for cron: check once and exit
  heartbeat
  if [ -f "$FLAG_FILE" ]; then
    deploy
  fi
  exit 0
fi

# Daemon mode: loop until killed
log "ChoreQuest watchdog started (PID $$). Monitoring: $FLAG_FILE"
log "Press Ctrl+C to stop."

while true; do
  heartbeat
  if [ -f "$FLAG_FILE" ]; then
    deploy
  fi
  sleep 30
done
