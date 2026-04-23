/**
 * Bounty Board integration tests.
 *
 * Tests the full lifecycle via API (no browser needed for state transitions):
 *   parent marks chore as bounty → kid sees it on the board →
 *   kid claims → kid turns in → parent approves → XP awarded
 *
 * Also tests:
 *   - Double-claim is blocked
 *   - Kid can abandon and re-claim
 *   - Parent rejection clears the claim
 *   - XP is only awarded on verify, not on turn-in
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

async function apiPut(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Create a fresh chore and mark it as a bounty. Returns chore. */
async function createBounty(parentToken) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const categoryId = cats[0]?.id;
  if (!categoryId) throw new Error('No categories in DB');

  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `Bounty Quest ${Date.now()}`,
      points: 30,
      difficulty: 'medium',
      recurrence: 'once',
      category_id: categoryId,
    }),
  });
  const chore = await res.json();
  if (!chore.id) throw new Error(`Chore creation failed: ${JSON.stringify(chore)}`);

  // Mark as bounty
  const updated = await apiPut(`/api/chores/${chore.id}`, parentToken, { is_bounty: true });
  expect(updated.status, `set is_bounty failed: ${JSON.stringify(updated.body)}`).toBe(200);

  return chore;
}

// ---------------------------------------------------------------------------
// API-level bounty lifecycle tests
// ---------------------------------------------------------------------------

test.describe('Bounty Board — API lifecycle', () => {
  test('bounty appears on the board after marking chore as bounty', async () => {
    const { parentToken, kidToken } = loadTokens();
    const chore = await createBounty(parentToken);

    const board = await apiGet('/api/bounty', kidToken);
    const found = board.find((b) => b.id === chore.id);
    expect(found, `Bounty ${chore.id} not on board. Board: ${JSON.stringify(board.map((b) => b.id))}`).toBeTruthy();
  });

  test('full flow: claim → turn in → parent approve → XP awarded', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const chore = await createBounty(parentToken);

    // XP before
    const before = await apiGet(`/api/points/${kidId}`, parentToken);
    const xpBefore = before.balance;

    // Kid claims (bounty claim endpoint returns 201 Created)
    const claim = await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
    expect(claim.status, `claim failed: ${JSON.stringify(claim.body)}`).toBeLessThan(300);

    // Kid turns in (FormData — same as browser)
    const fd = new FormData();
    const turnIn = await fetch(`${BASE}/api/bounty/${chore.id}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidToken}` },
      body: fd,
    });
    expect(turnIn.status, `turn-in failed`).toBe(200);

    // XP should NOT increase yet — only after parent approval
    const midway = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(midway.balance).toBe(xpBefore);

    // Get the claim ID from the review queue
    const pendingClaims = await apiGet('/api/bounty/claims', parentToken);
    const myClaim = pendingClaims.find((c) => c.chore_id === chore.id);
    expect(myClaim, 'Claim not in pending queue').toBeTruthy();

    // Parent approves
    const verify = await apiPost(`/api/bounty/claims/${myClaim.id}/verify`, parentToken);
    expect(verify.status, `verify failed: ${JSON.stringify(verify.body)}`).toBe(200);

    // XP must now be awarded
    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBeGreaterThanOrEqual(xpBefore + 30);
  });

  test('double-claim by same kid is blocked with 4xx error', async () => {
    const { kidToken } = loadTokens();
    const { parentToken } = loadTokens();
    const chore = await createBounty(parentToken);

    const first = await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
    expect(first.status).toBeLessThan(300);

    // Backend returns 409 Conflict (or 400) for a duplicate claim
    const second = await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
  });

  test('kid can abandon and re-claim a bounty', async () => {
    const { parentToken, kidToken } = loadTokens();
    const chore = await createBounty(parentToken);

    // Claim
    await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);

    // Abandon
    const abandon = await fetch(`${BASE}/api/bounty/${chore.id}/claim`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${kidToken}` },
    });
    expect(abandon.status, 'abandon failed').toBeLessThan(300);

    // Re-claim
    const reclaim = await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
    expect(reclaim.status, `re-claim failed: ${JSON.stringify(reclaim.body)}`).toBeLessThan(300);
  });

  test('parent reject: claim is removed and XP is not awarded', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const chore = await createBounty(parentToken);

    const before = await apiGet(`/api/points/${kidId}`, parentToken);

    await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
    const fd = new FormData();
    await fetch(`${BASE}/api/bounty/${chore.id}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidToken}` },
      body: fd,
    });

    const claims = await apiGet('/api/bounty/claims', parentToken);
    const myClaim = claims.find((c) => c.chore_id === chore.id);
    expect(myClaim).toBeTruthy();

    // Parent rejects
    const reject = await apiPost(`/api/bounty/claims/${myClaim.id}/reject`, parentToken);
    expect(reject.status, `reject failed: ${JSON.stringify(reject.body)}`).toBe(200);

    // XP must not change
    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBe(before.balance);

    // Claim must no longer be in the pending queue
    const pendingAfter = await apiGet('/api/bounty/claims', parentToken);
    const stillPending = pendingAfter.find((c) => c.chore_id === chore.id);
    expect(stillPending).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Browser-level bounty board tests
// ---------------------------------------------------------------------------

test.describe('Bounty Board — UI (kid)', () => {
  test('bounty board page loads without errors', async ({ loginAsKid: page }) => {
    await page.goto('/bounty');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=The Bounty Board')).toBeVisible();
    await expect(page).not.toHaveURL(/login/);
  });

  test('board shows Accept Bounty button when bounty exists and not claimed', async ({ loginAsKid: page }) => {
    const { parentToken } = loadTokens();
    await createBounty(parentToken);

    await page.goto('/bounty');
    await page.waitForLoadState('networkidle');

    // At least one unclaimed bounty should show the Accept button
    await expect(page.locator('button:has-text("Accept Bounty")').first()).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Bounty Board — UI (parent)', () => {
  test('parent sees Active Board and Review Claims tabs', async ({ loginAsParent: page }) => {
    await page.goto('/bounty');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Active Board')).toBeVisible();
    await expect(page.locator('text=Review Claims')).toBeVisible();
  });
});
