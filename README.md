# ⚔️ ChoreQuest

> *Turn chores into quests, kids into heroes.*

A gamified family chore management app with full RPG theming. Parents create quests, assign them to kids with per-child schedules, and kids earn XP by completing them.

> **This is a personal fork** of [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong), maintained with additional bug fixes, features, and improvements.

---

## ✨ Features

| | |
|---|---|
| 🗡️ **Quest Board** | Daily quest carousel with animated cards, tap to complete or attach photo proof |
| ⭐ **XP, Ranks & Streaks** | Earn XP per quest, climb 8 rank tiers, build daily streaks with freeze protection |
| 🎭 **Custom Avatars** | Full SVG editor — heads, hair, eyes, mouths, hats, gear, outfits, body shapes |
| 🐾 **Pets** | 6 companions that level up through 8 tiers; feed, pet, and play daily for bonus XP |
| 🛒 **Avatar Shop** | Unlock items by spending XP, reaching milestones, or random quest drops |
| 🎰 **Daily Spin Wheel** | Bonus XP wheel — earn spins from fully completed daily quests, carry unused spins forward |
| 🏪 **Treasure Shop** | Parents create rewards, kids redeem with XP |
| 📋 **Wishlist** | Kids add wish items; parents convert them into rewards |
| 🔄 **Quest Trading** | Siblings swap quests via the calendar with real-time notifications |
| 🏆 **Leaderboard** | Weekly XP rankings with streaks, ranks, and pet levels |
| 📅 **Calendar** | Weekly view with auto-generated recurring assignments and parent override verify |
| 🎉 **Seasonal Events** | Time-limited XP multiplier events |
| 🏖️ **Vacation Mode** | Pause quests per-kid or family-wide, streaks preserved automatically |
| 📊 **Progress Charts** | 30-day XP, quests completed, and completion rate charts |
| 🎊 **Party Page** | Family hub with bulletin board, shoutouts, avatars, and emotes |
| 🏅 **Tiered Achievements** | Bronze, Silver, and Gold tiers with downloadable SVG badges |
| ❄️ **Streak Freeze** | Auto streak protection once per calendar month |
| 🔔 **Push Notifications** | Web Push (VAPID) for quests, achievements, trades, and more |
| 📱 **Installable PWA** | Add to home screen on any device |
| 🛡️ **Admin Tools** | User management, API keys with scopes, invite codes, and audit log |
| 📺 **Kiosk / Wall Display** | Full-screen family dashboard for TVs and wall tablets |

---

## 🆕 What's New

Recent additions around AI-assisted drafting:

- **AI quest drafting** in the quest create modal for parents
- **AI reward drafting** in the rewards modal to turn kid wish ideas into polished rewards with suggested XP
- **Configurable AI providers**: Google Gemini, OpenAI, Anthropic Claude, and Ollama
- **Provider settings in-app** under **Settings → AI Quest Generation**
- **Privacy guardrails**: static style examples only, so existing family chore text is not sent upstream
- **Safety limits**: 5 generations every 5 minutes per parent, plus capped AI-suggested quest XP

For setup and day-to-day usage, see [AI-Assisted Quest & Reward Drafting](#-ai-assisted-quest--reward-drafting) below or the quest-focused wiki page: [AI-Assisted Quest Creation](https://github.com/turbogizzmo/ChoreQuest/wiki/AI-Assisted-Quest-Creation).

---

## 🚀 Quick Start

### Requirements

- Docker + Docker Compose

### Run

```bash
git clone https://github.com/turbogizzmo/ChoreQuest.git
cd ChoreQuest
```

Create a `.env` file:

```env
SECRET_KEY=your-secret-key-min-16-chars
TZ=America/Chicago
```

Start the app:

```bash
docker-compose up -d --build
```

App runs on port **8122**. The first user to register becomes admin. After that, new accounts require an invite code (generate from the Admin dashboard).

### Updating

```bash
git pull && docker-compose up -d --build
```

Your data (`./data`) is preserved across rebuilds. The Admin Dashboard shows a banner when a newer version is available on GitHub.

#### Auto-update with the host watchdog (optional)

ChoreQuest has a built-in one-click update flow. When a new version is available, an admin clicks **Apply Update** in Settings — the app writes a flag file to `./data/.update_requested`, and a lightweight host-side script picks it up and handles the rest.

Run `watchdog.sh` once on the host (outside Docker):

```bash
nohup bash /path/to/ChoreQuest/watchdog.sh >> /path/to/ChoreQuest/data/watchdog.log 2>&1 &
```

Or add it as a cron job that checks every minute:

```cron
* * * * * /bin/bash /path/to/ChoreQuest/watchdog.sh --cron >> /path/to/ChoreQuest/data/watchdog.log 2>&1
```

When triggered, `watchdog.sh` runs `deploy.sh` which does `git pull` + `docker compose build --no-cache` + `docker compose up -d`. The app shows a full-screen update overlay to all connected users during the rebuild and auto-reloads when the new container is ready.

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | *required* | JWT signing key, min 16 characters |
| `TZ` | `Europe/London` | Container timezone |
| `REGISTRATION_ENABLED` | `false` | Allow public self-registration |
| `DATABASE_URL` | `sqlite+aiosqlite:////app/data/chores_os.db` | Database path |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `CORS_ORIGINS` | *(empty)* | Comma-separated allowed origins |
| `MAX_UPLOAD_SIZE_MB` | `5` | Photo proof upload size limit |
| `DAILY_RESET_HOUR` | `0` | Hour (local time, respects `TZ`) the daily quest reset runs |
| `GITHUB_REPO` | `turbogizzmo/ChoreQuest` | Repo used for in-app update checks |
| `VAPID_PUBLIC_KEY` | *(empty)* | VAPID public key for push notifications |
| `VAPID_PRIVATE_KEY` | *(empty)* | VAPID private key for push notifications |
| `VAPID_CLAIM_EMAIL` | `mailto:admin@example.com` | Contact email for push requests |
| `GEMINI_API_KEY` | *(empty)* | Optional Gemini API key override for AI quest generation |
| `OPENAI_API_KEY` | *(empty)* | Optional OpenAI API key override for AI quest generation |
| `ANTHROPIC_API_KEY` | *(empty)* | Optional Anthropic API key override for AI quest generation |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Optional Ollama base URL override for AI quest generation |

### Data persistence

All data lives in `./data`:
- `chores_os.db` — SQLite database
- `uploads/` — photo proof files

Back up this directory to preserve everything.

---

## 🤖 AI-Assisted Quest & Reward Drafting

Parents can turn a plain chore idea like `clean the garage` into a fantasy-styled quest draft directly from the quest creation modal.

### What it does

- Rewrites a plain chore into a quest-style **title** and **description**
- Suggests **XP**, **difficulty**, and the best-fit **category**
- Prefills the normal quest form so the parent can review and edit before saving
- Drafts reward **title**, **description**, **category**, **icon**, and **XP cost**
- Uses the same helper in the rewards modal to polish kid wish ideas and suggest XP from an estimated real-world cost when relevant

### How to set it up

You have two ways to configure AI providers:

1. **In the app**
   - Sign in as a **parent or admin**
   - Open **Profile → Family Settings**
   - Find **AI Quest Generation**
   - Choose a provider, enter the required fields, and click **Save AI Provider**

2. **With environment variables**
   - Add one or more provider values to `.env`
   - Restart the app after changing env values
   - Environment variables take precedence over values saved in the app UI

### Provider options

- **Google Gemini**
  - Required: `API key`
  - Default provider for new setups
  - Good first choice if you want a low-friction hosted option

- **OpenAI**
  - Required: `API key`
  - Optional: `Organization`, `Project`
  - Lets you choose your own GPT model

- **Anthropic Claude**
  - Required: `API key`
  - Lets you choose your own Claude model

- **Ollama**
  - Required: `Base URL`, `Model`
  - No API key is required by default for a local Ollama instance
  - Useful for self-hosted/local model setups

### Environment examples

```env
# Gemini
GEMINI_API_KEY=your-gemini-api-key

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Anthropic
ANTHROPIC_API_KEY=your-anthropic-api-key

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
```

### How parents use it

1. Open **New Quest Scroll**
2. Click **Generate with AI**
3. Describe the chore in plain language
4. Review the generated draft
5. Edit anything you want, then save it like a normal quest

For rewards:

1. Open **Rewards → Add Reward**
2. Click **Research with AI**
3. Paste a kid wish, product idea, expected price, or reward notes
4. Review the suggested copy and XP cost
5. Edit anything you want, then save it like a normal reward

### Privacy and safety behavior

- Do **not** include names or private family details in the prompt
- The app uses static style examples and does **not** send your saved family chore text as prompt context
- Generation is limited to **5 requests every 5 minutes per parent**
- AI-suggested XP is capped before it reaches the save flow
- Reward drafts may estimate a retail price from the prompt, but parents should still sanity-check the suggested XP before saving
- Saved provider secrets are handled separately from normal settings and are not returned to the browser in plain text

### If the button does not appear

- Make sure at least one provider is configured successfully
- Check **Settings → AI Quest Generation** for the provider status pills
- If you are using env vars, restart the app after editing `.env`

---

## 🔔 Push Notifications

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys
```

Add to `.env`:

```env
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_CLAIM_EMAIL=mailto:you@example.com
```

> Push notifications require HTTPS. See [External Access](#-external-access) below.

---

## 🌐 External Access

ChoreQuest works well behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — free HTTPS, no port forwarding required.

```env
COOKIE_SECURE=true   # add this when running behind HTTPS
```

### Install as a PWA

Once on HTTPS:
- **iOS Safari** — Share → *Add to Home Screen*
- **Android Chrome** — Menu → *Install app*
- **Desktop Chrome/Edge** — Install icon in address bar

---

## 🔑 API

ChoreQuest exposes a full REST API. Two auth methods:

**JWT Bearer** (web app):
```
Authorization: Bearer <token>
```

**API Key** (automation/integrations):
```
X-API-Key: <your-api-key>
```

Generate API keys in **Admin → API Keys**. Keys authenticate as the creating admin and never expire unless revoked.

### Public dashboard (no auth)

```
GET /api/public/dashboard?token=<share-token>
```

Generate the share token in **Settings → Family Dashboard**. Add `?kiosk=1` for full-screen wall-display mode.

### Interactive docs

Full Swagger UI at `/docs` and ReDoc at `/redoc` when the server is running.

→ See the [API Reference wiki page](https://github.com/turbogizzmo/ChoreQuest/wiki/API-Reference) for the full endpoint list and examples.

---

## 🧪 Testing

```bash
./run-e2e.sh          # all E2E tests headless
./run-e2e.sh --ui     # Playwright visual UI
./run-e2e.sh --report # HTML report from last run
python3 -m pytest tests/unit/  # backend unit tests
```

Tests use an isolated environment — production data is never touched.

---

## 🧱 Tech Stack

| | |
|---|---|
| **Backend** | Python / FastAPI (async) |
| **Database** | SQLite (WAL mode) |
| **ORM** | SQLAlchemy 2.0 (async) |
| **Frontend** | React 18, Vite, Tailwind CSS 4 |
| **Animations** | Framer Motion |
| **Real-time** | WebSocket (per-user channels) |
| **Push** | Web Push / VAPID |
| **Auth** | JWT + httpOnly cookies, bcrypt, optional PIN |
| **Deployment** | Docker, single container |
| **Testing** | Playwright (E2E) · pytest (unit) · GitHub Actions CI |

---

## 📖 Wiki

Detailed documentation lives in the [GitHub Wiki](https://github.com/turbogizzmo/ChoreQuest/wiki):

- [Assignment System](https://github.com/turbogizzmo/ChoreQuest/wiki/Assignment-System) — recurrence, grace period, auto-generation
- [Streaks & Vacation](https://github.com/turbogizzmo/ChoreQuest/wiki/Streaks-and-Vacation) — streak logic, freeze, vacation mode
- [Rotation System](https://github.com/turbogizzmo/ChoreQuest/wiki/Rotation-System) — cadences, inverse linking
- [Parent Tools](https://github.com/turbogizzmo/ChoreQuest/wiki/Parent-Tools) — calendar, verify override, bounty board, audit log
- [AI-Assisted Quest Creation](https://github.com/turbogizzmo/ChoreQuest/wiki/AI-Assisted-Quest-Creation) — provider setup, usage, privacy, troubleshooting
- [Achievements & Ranks](https://github.com/turbogizzmo/ChoreQuest/wiki/Achievements-and-Ranks) — tiers, XP thresholds
- [Avatar & Pets](https://github.com/turbogizzmo/ChoreQuest/wiki/Avatar-and-Pets) — editor, pet levels, drops
- [Adventure Mode](https://github.com/turbogizzmo/ChoreQuest/wiki/Adventure-Mode) — gameplay loop, enemies, rewards, weapons
- [API Reference](https://github.com/turbogizzmo/ChoreQuest/wiki/API-Reference) — full endpoint list and examples
- [Troubleshooting](https://github.com/turbogizzmo/ChoreQuest/wiki/Troubleshooting) — common issues and debug tools

### ⚔️ Adventure Mode quick guide

Adventure Mode is a top-down action map where kids defeat enemies, complete portal chores, and spend coins on weapon upgrades.

- **Launch:** Kids can open Adventure Mode from their dashboard. Parents/admins can launch **Try Adventure** in preview mode.
- **Controls:** Move with keyboard/touch controls, **SPACE** to attack, **ESC** to pause.
- **Progress sync:** Kid progress is synced to `/api/progress/adventure/progress` and ranked on `/api/progress/adventure/leaderboard`.  
  Preview mode is clearly marked and does **not** count on the leaderboard.

#### How rewards work

- Defeat enemies and bosses to earn **XP + coins**.
- Portal chores also grant **XP + coins** and help restore each district.
- Treasure chests have a **20% drop chance** on enemy defeat and award random XP/coin bundles.
- Periodic **Chore Surge** events temporarily boost XP gains to **2×**.

#### Enemy roster

Regular enemies:

- Dust Bunny — 8 HP, +2 XP, +1 coin
- Sock Goblin — 12 HP, +3 XP, +2 coins
- Crumb Slime — 6 HP, +1 XP, +1 coin
- Mop Golem — 18 HP, +5 XP, +3 coins
- Trash Bag Ghost — 9 HP, +4 XP, +2 coins

Bosses (one per district, 24h respawn):

- Grime Lord — 24 HP, +15 XP, +8 coins
- Lint Titan — 30 HP, +18 XP, +10 coins
- Weed Golem — 20 HP, +12 XP, +7 coins
- Paper Wraith — 18 HP, +10 XP, +6 coins

#### Weapons

- **Broom Swipe** (starter): damage 3, range 72, cooldown 500 ms
- **Vacuum Blast**: damage 4, range 88, cooldown 800 ms (**20 coins**)
- **Toss Sponge**: damage 2, range 120, cooldown 600 ms (**35 coins**)
- **Soap Attack**: damage 5, range 56, cooldown 1000 ms (**60 coins**)

---

## 🙏 Credits

Forked from [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong). Original concept, design, and core implementation by the upstream author.
