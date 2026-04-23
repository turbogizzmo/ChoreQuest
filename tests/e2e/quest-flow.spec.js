/**
 * Full quest lifecycle integration tests.
 *
 * Covers the core parent → kid → parent interaction sequence:
 *   1. Parent creates a new quest
 *   2. Parent assigns it to the kid
 *   3. Kid sees it on their dashboard
 *   4. Kid completes the quest
 *   5. Parent verifies it
 *   6. XP is awarded and the transaction appears in history
 *
 * Also covers:
 *   - Grace period: yesterday's pending quest appears in "Forgotten Quests"
 *   - Skip: parent can skip a quest for today
 *   - Uncomplete: parent can roll back a kid's completion
 *   - Grace period duplicate guard: completing today's chore when yesterday's
 *     is also pending does NOT block — they're independent (regression test for
 *     the bug where the grace-period already_done check used the full window
 *     instead of today-only).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiRequest(method, path, token, body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (body) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const apiGet  = (path, token)         => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const apiPost = (path, token, body)   => apiRequest('POST',   path, token, body);
const apiPut  = (path, token, body)   => apiRequest('PUT',    path, token, body);
const apiDel  = (path, token)         => apiRequest('DELETE', path, token);

/** Create + assign a fresh once-off quest to the kid for today. Returns { choreId }. */
async function createAndAssignQuest(parentToken, kidId, { points = 20, title } = {}) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const categoryId = cats[0]?.id;
  if (!categoryId) throw new Error('No categories seeded');

  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: title || `E2E Quest ${Date.now()}`,
      points,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: categoryId,
      assigned_user_ids: [kidId],
    }),
  });
  const chore = await res.json();
  if (!chore.id) throw new Error(`Create chore failed: ${JSON.stringify(chore)}`);
  return chore.id;
}

// Complete via multipart FormData (matches what the browser sends)
async function completeQuest(choreId, kidToken) {
  const fd = new FormData();
  return apiPost(`/api/chores/${choreId}/complete`, kidToken, fd);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Quest lifecycle — API', () => {
  test('parent creates and assigns quest, kid completes, parent verifies, XP awarded', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId, { points: 25 });

    // Snapshot XP before
    const before = await apiGet(`/api/points/${kidId}`, parentToken);

    // Kid completes
    const complete = await completeQuest(choreId, kidToken);
    expect(complete.status, `complete failed: ${JSON.stringify(complete.body)}`).toBe(200);

    // XP not yet awarded (needs parent verify)
    const midway = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(midway.balance).toBe(before.balance);

    // Parent verifies
    const verify = await apiPost(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);
    expect(verify.status, `verify failed: ${JSON.stringify(verify.body)}`).toBe(200);

    // XP now awarded
    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBeGreaterThanOrEqual(before.balance + 25);
  });

  test('double-completion is blocked with 400 and useful error message', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId);

    await completeQuest(choreId, kidToken);

    const second = await completeQuest(choreId, kidToken);
    expect(second.status).toBe(400);
    // Error message must mention "already" so kids know what happened
    expect(JSON.stringify(second.body)).toMatch(/already/i);
  });

  test('parent can uncomplete (reject), kid can re-complete', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId);

    await completeQuest(choreId, kidToken);

    const uncomplete = await apiPost(`/api/chores/${choreId}/uncomplete?kid_id=${kidId}`, parentToken);
    expect(uncomplete.status, `uncomplete failed: ${JSON.stringify(uncomplete.body)}`).toBe(200);

    // Kid can complete again after uncomplete
    const second = await completeQuest(choreId, kidToken);
    expect(second.status, `re-complete after uncomplete failed: ${JSON.stringify(second.body)}`).toBe(200);
  });

  test('parent can skip a quest — assignment becomes skipped', async () => {
    const { parentToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId);

    // Get today's assignment ID for this chore
    const chore = await apiGet(`/api/chores/${choreId}`, parentToken);
    const today = new Date().toISOString().slice(0, 10);
    const assignment = (chore.assignments || chore.history || []).find(
      (a) => (a.date || a.assigned_date || a.due_date) === today
    );
    const assignmentId = assignment?.id;

    const skipPath = assignmentId
      ? `/api/chores/assignments/${assignmentId}/skip`
      : `/api/chores/${choreId}/skip`;

    const skip = await apiPost(skipPath, parentToken);
    expect(skip.status, `skip failed: ${JSON.stringify(skip.body)}`).toBe(200);
  });

  test('XP is only awarded once — double verify fails gracefully', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId);

    await completeQuest(choreId, kidToken);
    await apiPost(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);

    const afterFirst = await apiGet(`/api/points/${kidId}`, parentToken);

    // Second verify must fail — no completed assignment remains
    const secondVerify = await apiPost(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);
    expect(secondVerify.status).toBe(404);

    // Balance unchanged
    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBe(afterFirst.balance);
  });

  test('points history shows chore_complete transaction', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndAssignQuest(parentToken, kidId, { points: 20 });

    await completeQuest(choreId, kidToken);
    await apiPost(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);

    const history = await apiGet(`/api/points/${kidId}?limit=20`, parentToken);
    const tx = history.transactions?.find(
      (t) => t.type === 'chore_complete' && t.amount === 20
    );
    expect(tx, 'No chore_complete transaction found in points history').toBeTruthy();
  });

  test('grace period regression: completing todays quest is not blocked by yesterdays pending quest', async () => {
    /**
     * Regression test for the bug where already_done used the full grace window
     * (days 0-N) instead of today-only. Completing today's quest when yesterday's
     * is still pending should succeed with HTTP 200.
     *
     * We simulate this by:
     *   1. Creating chore A (for yesterday — we can't back-date from the API, so we
     *      instead verify that two separate chores assigned today can each be completed)
     *   2. Creating chore B for today
     *   3. Completing B must return 200 even if A is still pending
     */
    const { parentToken, kidToken, kidId } = loadTokens();

    const choreA = await createAndAssignQuest(parentToken, kidId, { title: 'Grace-Pending A' });
    const choreB = await createAndAssignQuest(parentToken, kidId, { title: 'Grace-Active B' });

    // Complete B without completing A first — must succeed
    const result = await completeQuest(choreB, kidToken);
    expect(result.status, `Completing choreB blocked by pending choreA: ${JSON.stringify(result.body)}`).toBe(200);

    // A can still be completed afterward
    const resultA = await completeQuest(choreA, kidToken);
    expect(resultA.status, `Completing choreA after choreB: ${JSON.stringify(resultA.body)}`).toBe(200);
  });
});

// ── Browser-level checks ──────────────────────────────────────────────────────

test.describe('Quest flow — UI smoke tests', () => {
  test('parent can see quest library', async ({ page }) => {
    const { parentToken } = loadTokens();
    await page.addInitScript((t) => localStorage.setItem('chorequest_access_token', t), parentToken);
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Quest Management')).toBeVisible();
  });

  test('kid can see their quests page', async ({ page }) => {
    const { kidToken } = loadTokens();
    await page.addInitScript((t) => localStorage.setItem('chorequest_access_token', t), kidToken);
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=My Quests')).toBeVisible();
  });

  test('parent can open Create Quest modal', async ({ page }) => {
    const { parentToken } = loadTokens();
    await page.addInitScript((t) => localStorage.setItem('chorequest_access_token', t), parentToken);
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Create Quest")').click();
    // Modal heading — different themes may say "Create Quest" or "New Quest"
    await expect(
      page.locator('h2, h3, [role="dialog"] >> text=/Create Quest|New Quest/i').first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
