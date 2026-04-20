#!/usr/bin/env bash
# Run the full E2E test suite against an isolated test environment.
# Never touches production data.
#
# Usage:
#   ./run-e2e.sh              # run all tests (headless)
#   ./run-e2e.sh --ui         # open Playwright UI
#   ./run-e2e.sh --report     # show last HTML report

set -e
cd "$(dirname "$0")"

# Install Node deps if needed
if [ ! -d node_modules ]; then
  echo "→ Installing Playwright..."
  npm install
  npx playwright install chromium
fi

# Install frontend deps if needed
if [ ! -d frontend/node_modules ]; then
  echo "→ Installing frontend deps..."
  (cd frontend && npm install)
fi

# Run tests
if [ "$1" = "--ui" ]; then
  npx playwright test --ui
elif [ "$1" = "--report" ]; then
  npx playwright show-report
else
  npx playwright test "$@"
fi
