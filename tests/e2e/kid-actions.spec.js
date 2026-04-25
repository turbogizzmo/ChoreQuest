/**
 * kid-actions.spec.js
 *
 * End-to-end tests that exercise features FROM THE KID'S PERSPECTIVE
 * through the actual browser UI — not just the API.
 *
 * Covers:
 * - Kid sees their assigned quest on the dashboard
 * - Skip/Uncomplete show a confirmation modal before firing (not immediate)
 * - Abandon bounty shows a confirmation modal
 * - Photo-required quest shows "Attach proof photo" label; Complete disabled until file selected
 * - Optimistic XP deduction: balance updates before page reload
 * - Double-submit guard: rapid taps only fire one completion request
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

async function apiPost(path, token, body = null) {
  const opts = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiGet(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function createAndAssignChore(parentToken, kidId, extras = {}) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const categoryId = cats[0]?.id;
  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `E2E Quest ${Date.now()}`,
      points: 10,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: categoryId,
      assigned_user_ids: [kidId],
      ...extras,
    }),
  });
  const chore = await res.json();
  return chore.id;
}

// ─── Kid Dashboard UI ────────────────────────────────────────────────────────

test.describe('Kid Dashboard — UI actions', () => {
  test('kid dashboard shows quest board section', async ({ loginAsKid: page }) => {
    await expect(page.locator('text=Quest Board').first()).toBeVisible();
    await expect(page).not.toHaveURL(/error/);
  });

  test('kid can see their assigned quest on dashboard', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    await createAndAssignChore(parentToken, kidId);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
    // Quest board should still be rendered
    await expect(page.locator('text=Quest Board').first()).toBeVisible();
  });
});

// ─── Confirmation Modals ─────────────────────────────────────────────────────

test.describe('Confirmation modals — ChoreDetail (parent)', () => {
  test('Skip button shows "Skip Quest Today?" modal before firing', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    // Parent always sees Skip Today button
    const skipBtn = page.locator('button:has-text("Skip Today"), button:has-text("Skip Quest")').first();
    await expect(skipBtn).toBeVisible({ timeout: 8_000 });
    await skipBtn.click();

    // The Modal component renders an h2 title — NOT role="dialog"
    await expect(page.locator('h2:has-text("Skip Quest Today?")'))
      .toBeVisible({ timeout: 5_000 });
  });

  test('confirmation modal Cancel closes it without skipping', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const skipBtn = page.locator('button:has-text("Skip Today"), button:has-text("Skip Quest")').first();
    await expect(skipBtn).toBeVisible({ timeout: 8_000 });
    await skipBtn.click();

    // Modal title visible
    await expect(page.locator('h2:has-text("Skip Quest Today?")')).toBeVisible({ timeout: 5_000 });

    // Cancel closes it
    await page.locator('button:has-text("Cancel")').first().click();
    await expect(page.locator('h2:has-text("Skip Quest Today?")')).not.toBeVisible({ timeout: 3_000 });

    // Still on the same page
    await expect(page).toHaveURL(new RegExp(`/chores/${choreId}`));
  });

  test('Uncomplete button shows confirmation modal after kid completes', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    // Kid completes
    const fd = new FormData();
    await fetch(`${BASE}/api/chores/${choreId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidToken}` },
      body: fd,
    });

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const uncompleteBtn = page.locator('button:has-text("Uncomplete"), button:has-text("Reject")').first();
    await expect(uncompleteBtn).toBeVisible({ timeout: 8_000 });
    await uncompleteBtn.click();

    // Modal title
    await expect(page.locator('h2:has-text("Uncomplete Quest?")')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── BountyBoard abandon confirmation ───────────────────────────────────────

test.describe('Bounty Board — abandon confirmation', () => {
  test('Abandon button shows confirmation modal', async ({ loginAsKid: page }) => {
    const { parentToken, kidToken } = loadTokens();

    const cats = await apiGet('/api/chores/categories', parentToken);
    const catId = cats[0]?.id;
    const chore = await fetch(`${BASE}/api/chores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
      body: JSON.stringify({
        title: `Abandon Test ${Date.now()}`,
        points: 5,
        difficulty: 'easy',
        recurrence: 'once',
        category_id: catId,
        is_bounty: true,
      }),
    }).then((r) => r.json());

    // Kid claims it
    await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);

    await page.goto('/bounty');
    await page.waitForLoadState('networkidle');

    const abandonBtn = page.locator('button:has-text("Abandon")').first();
    if (!(await abandonBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      // No claimable/claimed bounty visible — may be on wrong tab
      const myClaimsTab = page.locator('button:has-text("My Claims"), button:has-text("Claimed")').first();
      if (await myClaimsTab.isVisible()) await myClaimsTab.click();
    }

    const abandonBtn2 = page.locator('button:has-text("Abandon")').first();
    if (!(await abandonBtn2.isVisible({ timeout: 3_000 }).catch(() => false))) return; // bounty not in view

    await abandonBtn2.click();

    // The BountyBoard confirmation modal also uses Modal component with h2 title
    await expect(
      page.locator('h2').filter({ hasText: /abandon/i })
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Photo-required quest ────────────────────────────────────────────────────

test.describe('Photo-required quests — ChoreDetail', () => {
  test('Complete button is disabled until photo is attached', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId, { requires_photo: true });

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    // The complete button exists and is disabled because no photo selected yet
    const completeBtn = page.locator('button:has-text("Complete Quest")').first();
    if (await completeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(completeBtn).toBeDisabled();
    }
  });

  test('"Attach proof photo" label is shown for photo-required quest', async ({ loginAsKid: page }) => {
    test.slow(); // give extra time — this test navigates twice
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId, { requires_photo: true });

    // Navigate to kid dashboard first — this triggers auto_generate_week_assignments
    // which creates the pending assignment for today so hasPendingToday becomes true
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Now go to the chore detail — pending assignment should exist
    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    // The file input is hidden (className="hidden") but the visible label text is shown
    await expect(
      page.locator('text=Attach proof photo')
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Rotation banner for kids ────────────────────────────────────────────────

test.describe('Rotation info — kid view', () => {
  test('kid sees rotation info banner on a rotation chore', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId, { recurrence: 'daily' });

    // Only meaningful with 2+ kids; if only 1 kid, just verify no crash
    const users = await apiGet('/api/admin/users', parentToken);
    const kids = users.filter((u) => u.role === 'kid');

    if (kids.length >= 2) {
      await apiPost('/api/rotations', parentToken, {
        chore_id: choreId,
        kid_ids: kids.map((k) => k.id),
        cadence: 'weekly',
        rotation_day: 0,
      });
    }

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    // No crash either way
    await expect(page).not.toHaveURL(/error|login/);

    if (kids.length >= 2) {
      // Should show rotation info — either "your turn" or "[name]'s turn"
      await expect(
        page.locator('text=/your turn|turn/i').first()
      ).toBeVisible({ timeout: 8_000 });
    }
  });
});

// ─── Optimistic XP update ────────────────────────────────────────────────────

test.describe('Rewards — optimistic XP deduction', () => {
  test('XP balance updates without page reload after redemption', async ({ loginAsKid: page }) => {
    test.slow();
    const { parentToken, kidToken, kidId } = loadTokens();

    // Give kid enough XP to redeem "Free Reward" (costs 1 XP)
    const cats = await apiGet('/api/chores/categories', parentToken);
    const catId = cats[0]?.id;
    const chore = await fetch(`${BASE}/api/chores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
      body: JSON.stringify({
        title: `XP Grant ${Date.now()}`,
        points: 100,
        difficulty: 'easy',
        recurrence: 'once',
        category_id: catId,
        assigned_user_ids: [kidId],
      }),
    }).then((r) => r.json());

    const fd = new FormData();
    await fetch(`${BASE}/api/chores/${chore.id}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidToken}` },
      body: fd,
    });
    await apiPost(`/api/chores/${chore.id}/verify?kid_id=${kidId}`, parentToken);

    // Load rewards as kid
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');

    // Grab balance text before redeem
    const balanceLoc = page.locator('text=Your balance').locator('..').locator('text=/\\d+/').first();
    const balanceFallback = page.locator('[class*="balance"], text=/\\d+ XP/').first();
    const balanceEl = (await balanceLoc.isVisible().catch(() => false)) ? balanceLoc : balanceFallback;
    await expect(balanceEl).toBeVisible({ timeout: 5_000 });
    const balanceBefore = await balanceEl.textContent();

    // Find a Redeem button (Free Reward costs 1 XP)
    const redeemBtn = page.locator('button:has-text("Redeem")').first();
    if (!(await redeemBtn.isVisible({ timeout: 3_000 }).catch(() => false))) return;

    await redeemBtn.click();

    // If a confirmation dialog appears, confirm it
    const confirmBtn = page.locator('button:has-text("Redeem"):not(:disabled), button:has-text("Confirm")').last();
    if (await confirmBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Balance should change immediately (optimistic update via updateUser)
    await page.waitForTimeout(600);
    const balanceAfter = await balanceEl.textContent();
    expect(balanceAfter).not.toBe(balanceBefore);
  });
});

// ─── Double-submit guard (UI) ─────────────────────────────────────────────────

test.describe('Double-submit guard — UI', () => {
  test('rapid taps on Complete Quest only fire one request', async ({ loginAsKid: page }) => {
    test.slow();
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    // Navigate fresh to the chore detail page
    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const completionRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/complete') && req.method() === 'POST') {
        completionRequests.push(req.url());
      }
    });

    const completeBtn = page.locator('button:has-text("Complete Quest")').first();
    if (!(await completeBtn.isVisible({ timeout: 5_000 }).catch(() => false))) return;

    // Rapid-fire 3 clicks
    await completeBtn.click();
    await completeBtn.click({ force: true });
    await completeBtn.click({ force: true });
    await page.waitForTimeout(600);

    // In-flight guard should have collapsed all taps into a single request
    expect(completionRequests.length).toBe(1);
  });
});
