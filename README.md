# ⚔️ ChoreQuest

> *Turn chores into quests, kids into heroes.*

A gamified family chore management app with full RPG theming. Parents create quests, assign them to kids with per-child schedules, and kids earn XP by completing them. Progress is tracked through streaks, ranks, tiered achievements (Bronze/Silver/Gold), a leaderboard, a daily spin wheel, and a treasure shop where kids spend earned XP. Kids customise animated SVG avatars with pets that level up alongside them — feed, pet, and play with your companions for bonus XP.

> **This is a personal fork** of [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong), maintained with additional bug fixes, features, and improvements.

---

## ✨ What's different in this fork

- Grace period for late chore completion (kids can mark yesterday's quests done)
- Forgotten Quests section on the kid dashboard with a Mark Done button
- Quest template picker fixed (was silently broken due to a route ordering bug)
- Notification taps now navigate to the correct kid's quest page
- Full quest and reward descriptions always visible (no truncation)
- 26 additional RPG-themed quest templates (+ 🐛 Bug Hunter template)
- Timezone bug fix — no more "week_start must be Monday" errors
- End-to-end test suite (Playwright, 244 tests, isolated test environment)
- Backend unit tests (pytest) covering rotation, assignment generation, streaks, stats, and API key auth
- GitHub Actions CI — three jobs run automatically on every PR (shell lint, backend unit tests, E2E)
- Kiosk / wall-display mode for the public family dashboard (`?kiosk=1`)
- Inverse rotation linking — pair two chores so they always swap between kids together
- REST API key authentication (`X-API-Key` header) — full read/write access without browser login
- Debug endpoints toggle in Settings UI — no container restart needed
- Dashboard share tokens shortened to 8 characters

---

## ✨ Features at a glance

| | |
|---|---|
| 🗡️ **Quest Board** | Daily quest carousel with animated cards, themed boards, tap to complete or attach photo proof |
| ⭐ **XP, Ranks & Streaks** | Earn XP per quest, climb 8 rank tiers from Apprentice to Mythic, build daily streaks |
| 🎭 **Custom Avatars** | Full SVG editor: 9 head shapes, 20 hair styles, 15 eye styles, 14 mouths, 3 body shapes, 12 hats, 7 gear items, 7 face extras, 6 outfit patterns — with idle animations |
| 🐾 **Pets** | 6 companion pets that earn XP and level up through 8 tiers. Feed, pet, and play daily for bonus XP |
| 🛒 **Avatar Shop** | Unlock items by spending XP, reaching streaks, or random quest drops — with rarity tiers from common to legendary |
| 🎰 **Daily Spin Wheel** | Animated bonus wheel (1–25 XP) unlocked by finishing all daily quests |
| 🏪 **Treasure Shop** | Parents create categorised rewards, kids filter and redeem with XP |
| 📋 **Wishlist** | Kids add wishlist items; parents convert them into rewards |
| 🔄 **Quest Trading** | Siblings propose quest swaps via the calendar with real-time notifications |
| 🏆 **Leaderboard** | Weekly XP rankings with quest counts, streaks, ranks, and pet levels |
| 📅 **Calendar** | Weekly view with auto-generated recurring assignments |
| 🎉 **Seasonal Events** | Time-limited XP multiplier events |
| 🏖️ **Vacation Mode** | Pause quests and preserve streaks during holidays |
| 📊 **Progress Charts** | 30-day charts showing XP, quests completed, and completion rates |
| 🎊 **Party Page** | Family hub with bulletin board, avatars, ranks, shoutouts, and emotes |
| 🏅 **Tiered Achievements** | Bronze, Silver, and Gold tiers — downloadable SVG badges |
| ❄️ **Streak Freeze** | Automatic streak protection once per month |
| 🔔 **Push Notifications** | Web Push (VAPID) for quests, achievements, trades, and more |
| 📱 **Installable PWA** | Add to home screen on any device |
| 🛡️ **Admin Tools** | User management, API keys, invite codes, and audit log |

---

## 🚀 Self-hosting

### Run with Docker

```bash
git clone https://github.com/turbogizzmo/ChoreQuest.git
cd ChoreQuest
```

Create a `.env` file:

```env
SECRET_KEY=your-secret-key-min-16-chars
TZ=America/New_York
```

Then start:

```bash
docker-compose up -d --build
```

The app runs on port **8122**. The first user to register automatically becomes the admin. After that, registration requires an invite code (generate from the admin dashboard).

### Updating

The Admin Dashboard checks GitHub Releases on load and shows a banner when a newer version is available (cached for 1 hour, no GitHub account needed).

**To apply an update** — pull the latest code and rebuild:

```bash
git pull && docker compose up -d --build
```

Your data volume (`./data`) is preserved across restarts.

#### Automatic updates with Watchtower (optional)

[Watchtower](https://containrrr.dev/watchtower/) can watch for new image releases and restart ChoreQuest automatically. Add it to your `docker-compose.yml`:

```yaml
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 86400 chorequest
    restart: unless-stopped
```

This polls once per day (`86400` seconds) and recreates the container when a new image is published.

### Expose externally

ChoreQuest works well behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — no port forwarding needed, free HTTPS, and enables push notifications and PWA install on all devices.

> 💡 When running behind HTTPS, set `COOKIE_SECURE=true` in your environment.

### Install as a web app

Once accessible over HTTPS:

- **iOS Safari** — Tap share → *Add to Home Screen*
- **Android Chrome** — Tap menu → *Install app*
- **Desktop Chrome/Edge** — Click the install icon in the address bar

---

## 🔔 Push notifications

Generate VAPID keys (one-time setup):

```bash
npx web-push generate-vapid-keys
```

Add to your `.env`:

```env
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_CLAIM_EMAIL=mailto:you@example.com
```

> Push notifications require HTTPS.

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | *required* | JWT signing key, minimum 16 characters |
| `TZ` | `Europe/London` | Container timezone |
| `REGISTRATION_ENABLED` | `false` | Allow public registration without invite code |
| `DATABASE_URL` | `sqlite+aiosqlite:////app/data/chores_os.db` | Database path |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `CORS_ORIGINS` | *(empty)* | Comma-separated allowed origins |
| `MAX_UPLOAD_SIZE_MB` | `5` | Photo upload size limit |
| `DAILY_RESET_HOUR` | `0` | Hour (UTC) the daily quest reset runs |
| `LOGIN_RATE_LIMIT_MAX` | `10` | Max login attempts per window |
| `PIN_RATE_LIMIT_MAX` | `5` | Max PIN attempts per window |
| `REGISTER_RATE_LIMIT_MAX` | `5` | Max registration attempts per window |
| `ENABLE_DEBUG_ENDPOINTS` | `false` | *(legacy)* Initial seed value — use **Settings → Debug Endpoints** toggle instead |
| `GITHUB_REPO` | `turbogizzmo/ChoreQuest` | Repo used for in-app update checks |
| `VAPID_PUBLIC_KEY` | *(empty)* | VAPID public key for push notifications |
| `VAPID_PRIVATE_KEY` | *(empty)* | VAPID private key for push notifications |
| `VAPID_CLAIM_EMAIL` | `mailto:admin@example.com` | Contact email for push requests |

### Data persistence

All data lives in `./data` (Docker volume):
- `chores_os.db` — SQLite database
- `uploads/` — photo proof files

Back up this directory to preserve all app data.

---

## 🔑 API access

ChoreQuest exposes a REST API used by the web app and available for automation, home dashboards, and integrations.

### Authentication

Every endpoint (except the public family dashboard) requires authentication. Two methods are supported:

**JWT Bearer token** — used by the web app after login:
```
Authorization: Bearer <token>
```

**API key** — for automation, scripts, and integrations:
```
X-API-Key: <your-api-key>
```

API keys authenticate as the admin user who created them, giving full read/write access. They never expire unless explicitly revoked.

### Managing API keys

In ChoreQuest → **Settings → API Keys**:
- **Create** — give the key a name; the raw key is shown once — copy it now
- **Revoke** — immediately invalidates the key
- Keys are stored as SHA-256 hashes — the raw value is never retained server-side

### Public family dashboard (no auth)

A read-only overview of all kids' progress — safe to embed in a wall display (Echo Show, Home Assistant, etc.):

```
GET /api/public/dashboard?token=<share-token>
```

Generate the share token in **Settings → Family Dashboard**. Tokens are 8 characters and can be rotated or revoked at any time.

#### Kiosk / wall-display mode

Add `?kiosk=1` to the public dashboard URL for a full-screen display optimised for TVs and tablets:

```
https://your-chorequest-url/view?token=abc12345&kiosk=1
```

In kiosk mode the dashboard:
- Shows one kid at a time, full-screen, in large readable text
- Auto-cycles to the next kid every 10 seconds
- Refreshes data every 2 minutes
- Shows a live clock in the header
- Includes tap/click dot indicators for manual navigation

This works well with an Echo Show 15 via the MyPage Alexa skill (or any browser on a wall-mounted tablet).

### Common endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/chores` | List all active chores |
| `GET` | `/api/chores/{id}` | Chore detail with rotation summary |
| `GET` | `/api/assignments` | Today's assignments (all kids) |
| `GET` | `/api/rewards` | Reward catalogue |
| `GET` | `/api/users` | All users (parent/admin only) |
| `GET` | `/api/stats/family` | Family XP, streaks, completion stats |
| `GET` | `/api/notifications` | Current user's notifications |
| `POST` | `/api/chores` | Create a chore |
| `POST` | `/api/chores/{id}/assign` | Assign/rotate a chore (supports `inverse_of_chore_id`) |
| `POST` | `/api/rewards/{id}/redeem` | Kid redeems a reward |
| `GET` | `/api/health` | Server version + build date |

Full interactive docs are available at `/docs` (Swagger UI) and `/redoc` when the server is running.

### Inverse rotation linking

When two chores should always be assigned to opposite kids (e.g. one kid does dishes while the other cleans the counter, then they swap), set up an **inverse rotation link**:

1. Assign the first chore with a rotation enabled (e.g. Dishwasher: Kid A → Kid B)
2. Assign the second chore with a rotation and select the first chore in the **Inverse of** dropdown (e.g. Countertop: Kid B → Kid A, linked to Dishwasher)

Whenever the primary rotation advances — whether by the daily reset, the weekly boundary, or a manual parent advance — the linked rotation advances in lock-step. No extra configuration needed; the link is stored in the database and works across restarts.

Via the API:
```bash
curl -X POST https://your-chorequest-url/api/chores/2/assign \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "assignments": [{"user_id": 3, "recurrence": "daily"}, {"user_id": 4, "recurrence": "daily"}],
    "rotation": {"enabled": true, "cadence": "weekly", "inverse_of_chore_id": 1}
  }'
```

### Debug endpoints

Enable the diagnostic endpoint (`/api/chores/{id}/debug`) from **Settings → Feature Toggles → Debug Endpoints** — no container restart required. The endpoint returns the full DB state for a chore's rotation and assignments, useful for troubleshooting scheduling issues.

### Example — fetch today's family overview

```bash
curl https://your-chorequest-url/api/stats/family \
  -H "X-API-Key: your-api-key"
```

```bash
# Public dashboard — no API key needed
curl "https://your-chorequest-url/api/public/dashboard?token=abc12345"
```

---

## 🧪 End-to-end tests

```bash
./run-e2e.sh          # run all 244 tests headless
./run-e2e.sh --ui     # Playwright visual UI
./run-e2e.sh --report # HTML report from last run
```

Tests spin up an isolated backend and frontend — production is never touched.

---

## 🧱 Tech stack

| | |
|---|---|
| **Backend** | Python / FastAPI (async) |
| **Database** | SQLite (WAL mode) |
| **ORM** | SQLAlchemy 2.0 (async) |
| **Frontend** | React 18, Vite, Tailwind CSS 4 |
| **Animations** | Framer Motion |
| **Icons** | Lucide React |
| **Real-time** | WebSocket (per-user channels) |
| **Push** | Web Push / VAPID (pywebpush) |
| **Auth** | JWT + httpOnly refresh cookies, bcrypt, optional PIN |
| **Deployment** | Docker, single container |
| **Testing** | Playwright (E2E) · pytest (backend unit) · GitHub Actions CI |

---

## 🙏 Credits

Forked from [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong). Original concept, design, and implementation by the upstream author. This fork adds bug fixes, additional quest templates, and quality-of-life improvements for self-hosted family use.
