/**
 * adventure-mode.spec.js
 *
 * Tests Adventure Mode backend API:
 * - Kid can POST /api/progress/adventure/progress and stats persist
 * - Parent / admin gets 403 on that POST (kids-only endpoint)
 * - GET /api/progress/adventure/leaderboard returns kids sorted by XP
 * - No 4xx errors on leaderboard fetch from the kid dashboard
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';
const COLOR_TOLERANCE = 18;
const MIN_ALPHA = 220;

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

async function apiPut(path, body, token) {
  return fetch(`${BASE}${path}`, {
    method: 'PUT',
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

test.describe('Adventure mode preview', () => {
  test('parent can launch adventure preview from the dashboard without console errors', async ({ loginAsParent: page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.getByRole('button', { name: 'Try Adventure' }).click();

    await expect(page).toHaveURL(/\/adventure/);
    await expect(page.getByText("PREVIEW — XP won't count on leaderboard")).toBeVisible();
    await expect(page.getByText('Loading Adventure Mode...')).toBeHidden();
    await expect(page.locator('#adventure-game-container canvas').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Adventure avatar sync', () => {
  test('adventure player sprite uses the kid avatar colors', async ({ page }) => {
    const { kidToken } = loadTokens();
    const meRes = await apiGet('/api/auth/me', kidToken);
    expect(meRes.status).toBe(200);
    const me = await meRes.json();
    const originalConfig = me.avatar_config || {};

    const uniqueBodyColor = '#00ff66';
    const nextConfig = {
      ...originalConfig,
      body_color: uniqueBodyColor,
      accessory_color: '#00ccff',
      head_color: '#ff66cc',
      hair_color: '#6633ff',
    };

    try {
      const updateRes = await apiPut('/api/avatar', { config: nextConfig }, kidToken);
      expect(updateRes.status).toBe(200);

      await page.addInitScript((token) => {
        localStorage.setItem('chorequest_access_token', token);
      }, kidToken);
      await page.goto('/');
      await page.waitForSelector('nav');

      await page.goto('/adventure');
      await expect(page).toHaveURL(/\/adventure/);
      await expect(page.getByText('Loading Adventure Mode...')).toBeHidden();
      await expect(page.locator('#adventure-game-container canvas').first()).toBeVisible();
      await page.screenshot({ path: '/tmp/adventure-avatar-updated.png', fullPage: true });

      await page.waitForFunction(() => {
        const game = window.__CHOREQUEST_ACTIVE_GAME;
        const scene = game?.scene?.getScene?.('WorldScene');
        return Boolean(scene?.textures?.get?.('player')?.getSourceImage?.());
      });
      const hasCustomBodyColor = await page.evaluate(({ r, g, b, tolerance, minAlpha }) => {
        const game = window.__CHOREQUEST_ACTIVE_GAME;
        const scene = game?.scene?.getScene?.('WorldScene');
        const source = scene?.textures?.get?.('player')?.getSourceImage?.();
        if (!source) return false;

        const sample = document.createElement('canvas');
        sample.width = source.width;
        sample.height = source.height;
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        ctx.drawImage(source, 0, 0);
        const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
        for (let i = 0; i < data.length; i += 4) {
          const dr = Math.abs(data[i] - r);
          const dg = Math.abs(data[i + 1] - g);
          const db = Math.abs(data[i + 2] - b);
          if (dr <= tolerance && dg <= tolerance && db <= tolerance && data[i + 3] >= minAlpha) {
            return true;
          }
        }
        return false;
      }, { r: 0, g: 255, b: 102, tolerance: COLOR_TOLERANCE, minAlpha: MIN_ALPHA });

      expect(hasCustomBodyColor).toBe(true);
    } finally {
      await apiPut('/api/avatar', { config: originalConfig }, kidToken);
    }
  });
});
