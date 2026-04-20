/**
 * Runs once before all tests.
 * Seeds the test database with a parent account, a kid account, a reward,
 * and assigns a quest to the kid — giving every test a consistent baseline.
 */

const BASE = 'http://localhost:8199';

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

export default async function globalSetup() {
  // Wait for backend health
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // Register parent (first user → admin)
  const parent = await post('/api/auth/register', {
    username: 'e2e_parent',
    password: 'password123',
    display_name: 'Parent',
    role: 'parent',
  });
  const parentToken = parent.access_token;

  // Register kid
  const kid = await post('/api/auth/register', {
    username: 'e2e_kid',
    password: 'password123',
    display_name: 'Kid',
    role: 'kid',
  });
  const kidToken = kid.access_token;

  // Create a reward the parent can manage and the kid can see
  await post('/api/rewards', {
    title: 'Extra Screen Time',
    description: 'Get 30 extra minutes of screen time. Redeem any day this week!',
    point_cost: 50,
    icon: '🎮',
    category: 'Treats',
  }, parentToken);

  // Create a reward the kid can afford (0 cost) for redeem testing
  await post('/api/rewards', {
    title: 'Free Reward',
    description: 'This reward is free to claim anytime.',
    point_cost: 1,
    icon: '🎁',
  }, parentToken);

  // Get kid user ID for use in completion tests
  const kidInfo = await get('/api/admin/users', parentToken);
  const kidUser = kidInfo.find((u) => u.username === 'e2e_kid');
  const kidId = kidUser?.id;

  // Get available chores and assign one to the kid
  const chores = await get('/api/chores', parentToken);
  if (chores.length > 0) {
    const chore = chores[0];
    if (kidId) {
      await post(`/api/chores/${chore.id}/assign`, {
        user_ids: [kidId],
        recurrence: 'once',
        requires_photo: false,
      }, parentToken).catch(() => {}); // ignore if already assigned
    }
  }

  // Store tokens for tests to reuse (written to a temp file)
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
