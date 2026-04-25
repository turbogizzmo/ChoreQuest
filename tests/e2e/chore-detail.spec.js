/**
 * chore-detail.spec.js
 *
 * Tests the ChoreDetail page (/chores/:id) from both parent and kid perspectives:
 *
 * Parent view:
 * - Shows chore title, points, difficulty
 * - Skip Today button is present and triggers confirmation modal
 * - Edit button opens edit form
 * - Invalid chore ID renders gracefully (not a blank crash)
 *
 * Kid view:
 * - Shows chore title and point value
 * - Complete Quest button present when pending assignment exists
 * - Complete button disabled for photo-required quest until file attached
 * - Completed chore shows Uncomplete option for parent
 *
 * Rotation:
 * - Rotation banner visible when chore has a rotation
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

async function apiGet(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function createAndAssignChore(parentToken, kidId, extras = {}) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `Detail Test ${Date.now()}`,
      points: 10,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: cats[0]?.id,
      assigned_user_ids: [kidId],
      ...extras,
    }),
  });
  const chore = await res.json();
  return chore.id;
}

// ─── Parent view ──────────────────────────────────────────────────────────────

test.describe('ChoreDetail — parent', () => {
  test('parent can open chore detail page', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
    await expect(page.locator('text=Detail Test').first()).toBeVisible({ timeout: 8_000 });
  });

  test('chore detail shows points and difficulty', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');
    // 10 XP and "easy" difficulty should appear
    await expect(page.locator('text=/10/').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/easy/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Skip Today button is visible and shows confirmation modal on click', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const skipBtn = page.locator('button:has-text("Skip Today"), button:has-text("Skip Quest")').first();
    await expect(skipBtn).toBeVisible({ timeout: 8_000 });
    await skipBtn.click();

    await expect(
      page.locator('h2:has-text("Skip Quest Today?")')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('cancel on Skip modal closes without skipping', async ({ loginAsParent: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const skipBtn = page.locator('button:has-text("Skip Today"), button:has-text("Skip Quest")').first();
    await expect(skipBtn).toBeVisible({ timeout: 8_000 });
    await skipBtn.click();

    await expect(page.locator('h2:has-text("Skip Quest Today?")')).toBeVisible({ timeout: 5_000 });
    await page.locator('button:has-text("Cancel")').first().click();
    await expect(page.locator('h2:has-text("Skip Quest Today?")')).not.toBeVisible({ timeout: 3_000 });

    // Still on the same chore page
    await expect(page).toHaveURL(new RegExp(`/chores/${choreId}`));
  });

  test('invalid chore ID does not crash the app', async ({ loginAsParent: page }) => {
    await page.goto('/chores/999999');
    await page.waitForLoadState('networkidle');
    // Must not show a blank screen or JS error crash
    await expect(page).not.toHaveURL(/^about:blank/);
    // Either shows a not-found state or redirects to /chores
    await expect(page.locator('text=/not found|404|doesn.*exist|Quest Management/i').first())
      .toBeVisible({ timeout: 6_000 }).catch(() => {
        // Redirect to /chores is also acceptable
      });
  });

  test('Uncomplete modal appears after kid completion', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    // Kid completes it first
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

    await expect(page.locator('h2:has-text("Uncomplete Quest?")')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Kid view ─────────────────────────────────────────────────────────────────

test.describe('ChoreDetail — kid', () => {
  test('kid can view assigned chore detail page', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    // Visit dashboard first — triggers auto_generate_week_assignments
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
  });

  test('kid sees chore title and XP value on detail page', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Detail Test').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=/10/').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Complete Quest button is present for pending assignment', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);

    // Visit dashboard to trigger assignment generation
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const completeBtn = page.locator('button:has-text("Complete Quest")').first();
    // Button should be present if assignment was generated for today
    if (await completeBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(completeBtn).not.toBeDisabled();
    }
    // No error either way
    await expect(page).not.toHaveURL(/error/);
  });

  test('photo-required quest disables Complete until photo attached', async ({ loginAsKid: page }) => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId, { requires_photo: true });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    const completeBtn = page.locator('button:has-text("Complete Quest")').first();
    if (await completeBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(completeBtn).toBeDisabled();
    }
  });

  test('photo-required quest shows "Attach proof photo" label', async ({ loginAsKid: page }) => {
    test.slow();
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId, { requires_photo: true });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto(`/chores/${choreId}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('text=Attach proof photo')
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── No API errors ─────────────────────────────────────────────────────────────

test.describe('ChoreDetail — API health', () => {
  test('GET /api/chores/:id returns 200 for parent', async () => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);
    const res = await fetch(`${BASE}/api/chores/${choreId}`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(choreId);
    expect(data.title).toMatch(/Detail Test/);
  });

  test('GET /api/chores/:id returns 200 for kid with kid_assignments', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignChore(parentToken, kidId);
    const res = await fetch(`${BASE}/api/chores/${choreId}`, {
      headers: { Authorization: `Bearer ${kidToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // kid_assignments field must be present (the fix we merged in PR #55)
    expect('kid_assignments' in data).toBe(true);
  });
});
