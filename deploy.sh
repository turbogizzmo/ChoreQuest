#!/bin/bash
# deploy.sh — pull latest code and rebuild with version info baked in
set -e

# Always run from the repo root so docker compose finds .env and docker-compose.yml
cd "$(dirname "${BASH_SOURCE[0]}")"

# Synology Task Scheduler runs this as root, but the repo is usually owned by
# the DSM user — modern git then refuses with "detected dubious ownership".
# Trust this one repo for these git calls only (no global config change).
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$PWD"

if ! git pull --ff-only origin main; then
  echo "ERROR: git pull failed. Common causes:"
  echo "  - Local edits to tracked files: run 'git status' in $PWD, then 'git stash' or 'git checkout -- <file>'"
  echo "  - Local commits diverged from main: 'git log origin/main..HEAD' shows them"
  echo "  - No network / GitHub unreachable from the NAS"
  exit 1
fi

GIT_COMMIT=$(git rev-parse --short HEAD)
export GIT_COMMIT
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
export BUILD_DATE

echo "Deploying commit $GIT_COMMIT (built $BUILD_DATE)"

# Support both modern 'docker compose' (plugin) and legacy 'docker-compose' (standalone)
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi

echo "Using: $COMPOSE"
$COMPOSE build --no-cache
$COMPOSE up -d

echo "Done. Running version: $GIT_COMMIT"
