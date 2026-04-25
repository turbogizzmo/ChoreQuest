/**
 * Runs once before all tests.
 * Seeds the test database with a parent account, a kid account, rewards,
 * and assigns a quest to the kid — giving every test a consistent baseline.
 *
 * Includes retry logic for registration and assignment calls so transient
 * backend startup timing issues don't cause a full suite failure.
 */

const BASE = 'http://localhost:8199';

async function post(path, body, token, { retries = 3, label = path } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST ${label} → ${res.status}: ${text}`);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  ⚠ ${label} failed (attempt ${attempt}/${retries}): ${err.message} — retrying…`);
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  throw lastErr;
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

export default async function globalSetup() {
  // ── Wait for backend to be healthy ──────────────────────────────────────
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) { healthy = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!healthy) throw new Error('Backend did not become healthy in 15 s');

  // ── Register parent (first user → admin role) ────────────────────────────
  const parent = await post('/api/auth/register', {
    username: 'e2e_parent',
    password: 'password123',
    display_name: 'Parent',
    role: 'parent',
  }, null, { label: 'register parent' });
  const parentToken = parent.access_token;

  // ── Register kid ─────────────────────────────────────────────────────────
  const kid = await post('/api/auth/register', {
    username: 'e2e_kid',
    password: 'password123',
    display_name: 'Kid',
    role: 'kid',
  }, null, { label: 'register kid' });
  const kidToken = kid.access_token;

  // ── Seed rewards ──────────────────────────────────────────────────────────
  await post('/api/rewards', {
    title: 'Extra Screen Time',
    description: 'Get 30 extra minutes of screen time. Redeem any day this week!',
    point_cost: 50,
    icon: '🎮',
    category: 'Treats',
  }, parentToken, { label: 'create reward (screen time)' });

  await post('/api/rewards', {
    title: 'Free Reward',
    description: 'This reward is free to claim anytime.',
    point_cost: 1,
    icon: '🎁',
  }, parentToken, { label: 'create reward (free)' });

  // ── Look up kid user ID ───────────────────────────────────────────────────
  const allUsers = await get('/api/admin/users', parentToken);
  const kidUser = Array.isArray(allUsers)
    ? allUsers.find((u) => u.username === 'e2e_kid')
    : null;
  const kidId = kidUser?.id;

  if (!kidId) {
    console.warn('  ⚠ Could not resolve kid user ID — completion tests may fail');
  }

  // ── Assign a quest to the kid for today ──────────────────────────────────
  const chores = await get('/api/chores', parentToken);
  if (chores.length > 0 && kidId) {
    const chore = chores[0];
    await post(`/api/chores/${chore.id}/assign`, {
      assignments: [{ user_id: kidId, recurrence: 'once', requires_photo: false }],
    }, parentToken, { label: 'assign quest to kid', retries: 2 }).catch(() => {
      // Ignore — assignment may already exist or chore may not need assigning
    });
  }

  // ── Persist tokens for tests ─────────────────────────────────────────────
  const { writeFileSync } = await import('fs');
  writeFileSync('/tmp/chorequest_e2e_tokens.json', JSON.stringify({
    parentToken,
    kidToken,
    kidId,
    parentUsername: 'e2e_parent',
    parentPassword: 'password123',
    kidUsername: 'e2e_kid',
    kidPassword: 'password123',
  }));

  console.log('✓ E2E global setup complete');
}
