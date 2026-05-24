/**
 * adventure-mode.spec.js
 *
 * Tests Adventure Mode backend API:
 * - Kid can POST /api/progress/adventure/progress and stats persist
 * - Parent / admin gets 403 on that POST (kids-only endpoint)
 * - GET /api/progress/adventure/leaderboard returns kids sorted by XP
 * - No 4xx errors on leaderboard fetch from the kid dashboard
 *
 * Note: The /adventure route is kid-only and lazy-loaded; browser-level
 * tests that require the React component to fully mount are not reliable
 * in CI headless Chrome and are omitted here.
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

async function apiPost(path, body, token) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(path, token) {
  return fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// ─── Adventure progress sync ──────────────────────────────────────────────────

test.describe('Adventure progress sync', () => {
  test('kid can POST adventure progress — returns ok and values persist on leaderboard', async () => {
    const { kidToken } = loadTokens();

    const postRes = await apiPost('/api/progress/adventure/progress', {
      xp: 120,
      coins: 45,
      level: 3,
    }, kidToken);
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData).toMatchObject({ ok: true });

    // Verify persistence via leaderboard
    const lbRes = await apiGet('/api/progress/adventure/leaderboard', kidToken);
    expect(lbRes.status).toBe(200);
    const leaderboard = await lbRes.json();
    const kidEntry = leaderboard.find((e) => e.adventure_xp === 120);
    expect(kidEntry).toBeDefined();
    expect(kidEntry.adventure_coins).toBe(45);
    expect(kidEntry.adventure_level).toBe(3);
  });

  test('negative xp is clamped to 0', async () => {
    const { kidToken } = loadTokens();

    const postRes = await apiPost('/api/progress/adventure/progress', {
      xp: -50,
      coins: 0,
      level: 1,
    }, kidToken);
    expect(postRes.status).toBe(200);

    // Verify no negative XP on leaderboard
    const lbRes = await apiGet('/api/progress/adventure/leaderboard', kidToken);
    const leaderboard = await lbRes.json();
    leaderboard.forEach((e) => {
      expect(e.adventure_xp).toBeGreaterThanOrEqual(0);
    });
  });

  test('parent gets 403 on adventure progress POST', async () => {
    const { parentToken } = loadTokens();

    const res = await apiPost('/api/progress/adventure/progress', {
      xp: 999,
      coins: 999,
      level: 10,
    }, parentToken);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request gets 401', async () => {
    const res = await apiPost('/api/progress/adventure/progress', {
      xp: 10,
      coins: 5,
      level: 1,
    }, null);

    expect(res.status).toBe(401);
  });
});

// ─── Adventure leaderboard ────────────────────────────────────────────────────

test.describe('Adventure leaderboard', () => {
  test('returns an array sorted by xp descending', async () => {
    const { kidToken } = loadTokens();

    await apiPost('/api/progress/adventure/progress', { xp: 200, coins: 10, level: 4 }, kidToken);

    const res = await apiGet('/api/progress/adventure/leaderboard', kidToken);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].adventure_xp).toBeGreaterThanOrEqual(data[i].adventure_xp);
    }
  });

  test('leaderboard entries include required fields', async () => {
    const { kidToken } = loadTokens();

    const res = await apiGet('/api/progress/adventure/leaderboard', kidToken);
    expect(res.status).toBe(200);

    const data = await res.json();
    if (data.length > 0) {
      const entry = data[0];
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('adventure_xp');
      expect(entry).toHaveProperty('adventure_coins');
      expect(entry).toHaveProperty('adventure_level');
    }
  });

  test('parent can view the adventure leaderboard', async () => {
    const { parentToken } = loadTokens();

    const res = await apiGet('/api/progress/adventure/leaderboard', parentToken);
    expect(res.status).toBe(200);
  });

  test('unauthenticated leaderboard request gets 401', async () => {
    const res = await apiGet('/api/progress/adventure/leaderboard', null);
    expect(res.status).toBe(401);
  });

  test('no 4xx errors on leaderboard fetch from kid dashboard', async ({ loginAsKid: page }) => {
    const errors = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/progress/adventure/leaderboard') && res.status() >= 400) {
        errors.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});
