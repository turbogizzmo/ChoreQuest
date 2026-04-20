/**
 * Quest completion flow tests.
 *
 * Covers:
 * - Full flow: kid completes → parent verifies → XP awarded
 * - Double-completion guard: completing same quest twice is blocked
 * - Reject & re-complete: parent rejects → kid can complete again
 * - XP awarded only once (no double-verify double-award)
 * - Points history audit trail
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

/** POST to complete endpoint — must use multipart/form-data (File param). */
async function postComplete(choreId, token) {
  const fd = new FormData();
  const res = await fetch(`${BASE}/api/chores/${choreId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Generic JSON POST for verify / uncomplete / other endpoints. */
async function postJSON(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getJSON(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.json();
}

/** Creates a fresh once-off chore assigned to the e2e kid for today. Returns chore_id. */
async function createTestChore(parentToken, kidId) {
  // Fetch first available category (always seeded)
  const cats = await getJSON('/api/chores/categories', parentToken);
  const categoryId = cats[0]?.id;
  if (!categoryId) throw new Error('No categories seeded — cannot create test chore');

  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `Test Quest ${Date.now()}`,
      points: 20,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: categoryId,
      assigned_user_ids: [kidId],
    }),
  });
  const chore = await res.json();
  if (!chore.id) throw new Error(`Chore creation failed: ${JSON.stringify(chore)}`);
  return chore.id;
}

// ---------------------------------------------------------------------------
// Backend API tests — no browser, deterministic
// ---------------------------------------------------------------------------

test.describe('Quest completion — API', () => {
  test('full flow: complete → verify → XP awarded', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createTestChore(parentToken, kidId);

    const before = await getJSON(`/api/points/${kidId}`, parentToken);
    const xpBefore = before.balance;

    const complete = await postComplete(choreId, kidToken);
    expect(complete.status, `complete failed: ${JSON.stringify(complete.body)}`).toBe(200);

    const verify = await postJSON(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);
    expect(verify.status, `verify failed: ${JSON.stringify(verify.body)}`).toBe(200);

    const after = await getJSON(`/api/points/${kidId}`, parentToken);
    // At minimum the chore's 20 XP is awarded; achievements may add more
    expect(after.balance).toBeGreaterThanOrEqual(xpBefore + 20);
  });

  test('double-completion is blocked with 400', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createTestChore(parentToken, kidId);

    const first = await postComplete(choreId, kidToken);
    expect(first.status, `first complete failed: ${JSON.stringify(first.body)}`).toBe(200);

    const second = await postComplete(choreId, kidToken);
    expect(second.status).toBe(400);
    expect(second.body.detail).toMatch(/already been completed/i);
  });

  test('XP is awarded only once even on double verify attempt', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createTestChore(parentToken, kidId);

    const before = await getJSON(`/api/points/${kidId}`, parentToken);
    const xpBefore = before.balance;

    await postComplete(choreId, kidToken);
    await postJSON(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);

    // Snapshot after first verify (may include achievement bonuses)
    const afterFirst = await getJSON(`/api/points/${kidId}`, parentToken);
    expect(afterFirst.balance).toBeGreaterThan(xpBefore);

    // Second verify must fail — no completed assignment remains
    const secondVerify = await postJSON(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);
    expect(secondVerify.status).toBe(404);

    // Balance must not change after the failed second verify
    const after = await getJSON(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBe(afterFirst.balance);
  });

  test('parent reject (uncomplete) allows kid to re-complete', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createTestChore(parentToken, kidId);

    const first = await postComplete(choreId, kidToken);
    expect(first.status, `first complete failed: ${JSON.stringify(first.body)}`).toBe(200);

    const reject = await postJSON(`/api/chores/${choreId}/uncomplete?kid_id=${kidId}`, parentToken);
    expect(reject.status, `uncomplete failed: ${JSON.stringify(reject.body)}`).toBe(200);

    const second = await postComplete(choreId, kidToken);
    expect(second.status, `re-complete failed: ${JSON.stringify(second.body)}`).toBe(200);
  });

  test('points history shows chore_complete transaction after verify', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createTestChore(parentToken, kidId);

    await postComplete(choreId, kidToken);
    await postJSON(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);

    const history = await getJSON(`/api/points/${kidId}?limit=10`, parentToken);
    const tx = history.transactions.find(
      (t) => t.type === 'chore_complete' && t.amount === 20
    );
    expect(tx).toBeTruthy();
  });
});
