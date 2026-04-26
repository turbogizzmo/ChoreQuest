#!/bin/bash
# deploy.sh — pull latest code and rebuild with version info baked in
set -e

# Always run from the repo root so docker compose finds .env and docker-compose.yml
cd "$(dirname "${BASH_SOURCE[0]}")"

git pull origin main

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
