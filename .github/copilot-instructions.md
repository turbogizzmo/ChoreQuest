# ChoreQuest — Copilot instructions

## Fork policy

**Never propose a PR against the original (upstream) source repo from this fork, unless the user explicitly asks you to do so.** Assume all work targets the current fork only — any branches, PRs, or pushes should stay within this repository.

## Overview

Gamified family chore-management app. Python/FastAPI + async SQLAlchemy on SQLite, React 18 + Vite + Tailwind 4 frontend, served as one Docker container on port **8122**. The compiled frontend lives in `/static` and is served by FastAPI; in dev the Vite server proxies `/api` and `/ws` to the backend.

## Commands

```bash
# Backend (from repo root) — requires SECRET_KEY (>=16 chars, not in WEAK_SECRETS)
pip install -r requirements.txt
SECRET_KEY=<16+ chars> python -m uvicorn backend.main:app --reload --port 8122

# Frontend dev server (proxies /api + /ws to :8122)
cd frontend && npm install && npm run dev        # http://localhost:5173

# Production build — outputs to frontend/dist, then syncs into /static for the backend to serve
cd frontend && npm run deploy

# Full app via Docker
docker compose up -d   # needs SECRET_KEY in .env
```

Health check: `GET /api/health`.

## Test suites

Two separate test suites exist. **Always run them before merging a PR.**

### 1 — Playwright end-to-end tests (browser + API)

Covers 19 spec files × multiple tests across: auth flows, kid dashboard, parent dashboard, quest lifecycle, bounty board, rewards, calendar, settings, navigation, chore detail, mobile layout, leaderboard, profile, API security (RBAC), and more.

```bash
# From repo root — starts backend on :8199 + Vite dev server on :5174 automatically
npm install
cd frontend && npm install && cd ..
npx playwright install --with-deps chromium
npm run test:e2e                     # headless, full suite
npm run test:e2e:ui                  # interactive Playwright UI mode
```

The playwright config (`playwright.config.js`) spins up both servers via `webServer`. Tests use an isolated in-memory SQLite DB (`/tmp/chorequest_e2e.db`). Tokens are written to `/tmp/chorequest_e2e_tokens.json` by `global-setup.js`.

**CI:** runs automatically on every PR via `.github/workflows/ci.yml`. HTML reports are uploaded as artifacts.

### 2 — pytest backend unit tests (fast, no server needed)

Covers rotation logic, assignment generation, streak edge cases, and stats helpers. Uses in-memory SQLite — no external deps.

```bash
pip install -r requirements.txt
pip install -r requirements-test.txt   # pytest, pytest-asyncio, aiosqlite
SECRET_KEY=any-16-char-key pytest tests/unit/ -v
```

**CI:** runs as a separate fast job before the e2e suite in `.github/workflows/ci.yml`.

## Architecture

**Single-container monolith.** `backend/main.py` is the FastAPI entrypoint:

- `lifespan` runs `init_db()` → `install_push_hooks()` → `seed_database()` → launches `daily_reset_task()` (background loop that fires once per day at `DAILY_RESET_HOUR` UTC to generate recurring assignments, reset stale streaks honoring vacation days, and purge expired refresh tokens).
- Catch-all route at the bottom serves the built SPA from `/static/` (SPA fallback to `index.html` for any non-`/api/` path).
- WebSocket endpoint `/ws/{user_id}?token=...` validates the JWT access token in the query string and registers the socket with `ws_manager`.

**Backend layout:**

- `backend/models.py` — all SQLAlchemy models (~27 tables) in one file. Schema changes need corresponding ALTER entries in `database.py`'s `_migrations` list (SQLite-only, best-effort, `ADD COLUMN` in a try/except) — `Base.metadata.create_all` cannot add columns to existing tables.
- `backend/schemas.py` — all Pydantic request/response schemas in one file.
- `backend/routers/*.py` — one router per feature area, registered explicitly in `main.py`. Routers always import `get_db`, and use the `get_current_user` / `require_parent` / `require_admin` / `require_kid` dependencies from `backend/dependencies.py` for authz. `routers/_chores_helpers.py` holds shared helpers extracted from `chores.py`: `get_chore_or_404`, `reload_chore_with_category`, `reload_assignment_with_relations`, `quest_assigned_notification`, `build_rotation_summaries`.
- `backend/services/` — cross-cutting logic (assignment generation, recurrence rules, rotation, ranks, pet leveling, push dispatch). `push_hook.py`'s `install_push_hooks()` wires notification events → Web Push at startup.
- `backend/seed.py` — seeds default categories, 20 achievements, 24 quest templates, and app settings on first boot.
- `backend/auth.py` — JWT encode/decode, bcrypt password & PIN hashing, refresh-token creation.
- `backend/websocket_manager.py` — process-local `ws_manager` singleton; fan-out helpers: `send_to_user`, `broadcast`, `send_to_parents`.

**Frontend layout (`frontend/src/`):**

- `pages/` — route-level components (KidDashboard, ParentDashboard, AdminDashboard, Chores, Calendar, Party, Profile, etc.).
- `components/avatar/` — SVG avatar renderer composing heads/hair/eyes/mouths/bodies/hats/gear/face extras/outfit patterns/pets with animated idle effects.
- `hooks/` — `useAuth`, `useTheme`, `useWebSocket`, `useNotifications`, `usePushNotifications`.
- `api/client.js` — the **only** fetch wrapper; handles `Authorization: Bearer` injection, 401 → `/api/auth/refresh` → one retry, and dispatches `auth:expired` on refresh failure. Access token is kept in `localStorage` under `chorequest_access_token`; the refresh token is an httpOnly cookie.
- `public/sw.js` — service worker for caching, push, and offline. Its cache name is version-stamped at build time by the `swVersionStamp` Vite plugin (replaces `__BUILD_TS__`); the backend sends `Cache-Control: no-cache` for `/sw.js` so updates are picked up.

## Conventions

- **Roles are a three-level enum**: `admin > parent > kid`. `require_parent` allows admin too; `require_kid` is strictly kids. Never check `role == parent` manually — use the dependency.
- **All DB access is async.** Use `AsyncSession`, `select(...)` + `await db.execute(...)`, `db.commit()`. Eager-load relationships with `selectinload` when serializing.
- **Real-time + push go together.** When mutating user-visible state, send a WebSocket event via `ws_manager` (see table in README) *and* rely on `push_hook` for persistent push notifications. Generic UI invalidation uses `data_changed` with an entity type.
- **Streaks and vacations are entangled.** Vacation days preserve streaks (see `reset_stale_streaks` in `main.py` and `is_vacation_day` in `routers/vacation.py`). Streak freezes are consumed at quest-verification time in `routers/chores.py`, not in the daily reset.
- **XP is the canonical currency.** Award via `PointTransaction` rows (see `PointType` enum). Seasonal event multipliers compound when overlapping — look at existing code in `routers/chores.py` / `points.py` before re-implementing.
- **Display name limit is 10 chars**, enforced in schema, DB column length, and UI. Preserve this when touching user profile code.
- **Config is env-only** via `backend/config.py` (`pydantic-settings`). `SECRET_KEY` must be ≥16 chars and not match `WEAK_SECRETS`; the app hard-exits otherwise. Add new settings to the `Settings` class with a default, and document in README's env-var table. Debug/diagnostic endpoints must be gated behind `settings.ENABLE_DEBUG_ENDPOINTS` (default `false`) — never expose them unconditionally.
- **SQLite WAL mode** is enabled in `init_db()`. Data lives in `/app/data` (`chores_os.db` + `uploads/`); this is the Docker volume to back up.
- **CSP is strict**: `script-src 'self'` only — no inline scripts or external CDNs. Adding a third-party script means updating the CSP header in `main.py`'s `security_headers` middleware.
- **CI runs on every PR.** Two jobs: `backend-unit-tests` (pytest, ~10 s) and `e2e-tests` (Playwright, ~5 min). Both must pass before merging. Playwright reports and failure traces are uploaded as artifacts.
