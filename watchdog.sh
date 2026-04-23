#!/bin/bash
# watchdog.sh — monitors for in-app update requests and runs deploy.sh
#
# Run this once on the host (outside Docker):
#   nohup bash /path/to/ChoreQuest/watchdog.sh >> /path/to/ChoreQuest/data/watchdog.log 2>&1 &
#
# Or set it up as a cron job (checks every minute):
#   * * * * * /bin/bash /path/to/ChoreQuest/watchdog.sh --cron >> /path/to/ChoreQuest/data/watchdog.log 2>&1
#
# How it works:
#   1. The ChoreQuest app writes /app/data/.update_requested when an admin
#      clicks "Apply Update" in Settings.
#   2. This script detects that file (it's in the ./data/ folder on the host),
#      removes it, and runs deploy.sh to git pull + rebuild + restart.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLAG_FILE="$SCRIPT_DIR/data/.update_requested"
LOCK_FILE="$SCRIPT_DIR/data/.update_in_progress"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
CRON_MODE=false

[[ "${1:-}" == "--cron" ]] && CRON_MODE=true

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

deploy() {
  if [ -f "$LOCK_FILE" ]; then
    log "Deploy already in progress, skipping."
    return
  fi

  log "Update flag detected. Starting deploy..."
  touch "$LOCK_FILE"
  rm -f "$FLAG_FILE"

  if bash "$DEPLOY_SCRIPT"; then
    log "Deploy completed successfully."
  else
    log "ERROR: Deploy script exited with an error."
  fi

  rm -f "$LOCK_FILE"
}

if $CRON_MODE; then
  # Single-shot mode for cron: check once and exit
  if [ -f "$FLAG_FILE" ]; then
    deploy
  fi
  exit 0
fi

# Daemon mode: loop until killed
log "ChoreQuest watchdog started (PID $$). Monitoring: $FLAG_FILE"
log "Press Ctrl+C to stop."

while true; do
  if [ -f "$FLAG_FILE" ]; then
    deploy
  fi
  sleep 30
done
