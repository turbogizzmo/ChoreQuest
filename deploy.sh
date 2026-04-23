#!/bin/bash
# deploy.sh — pull latest code and rebuild with version info baked in
set -e

git pull origin main

export GIT_COMMIT=$(git rev-parse --short HEAD)
export BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Deploying commit $GIT_COMMIT (built $BUILD_DATE)"

docker compose build --no-cache
docker compose up -d

echo "Done. Running version: $GIT_COMMIT"
