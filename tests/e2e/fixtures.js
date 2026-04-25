import { test as base } from '@playwright/test';
import { readFileSync } from 'fs';

function loadTokens() {
  try {
    return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * loginAs — injects the auth token using addInitScript, which runs
 * synchronously before any page JS fires on every navigation.
 *
 * Why not evaluate()?
 *   goto('/') causes an immediate redirect to /login (no token yet).
 *   The redirect destroys the execution context before evaluate() can run,
 *   causing "Execution context was destroyed" on ~40% of test runs.
 *
 * addInitScript() bypasses this because it's injected at the browser level
 * before any page script executes — so localStorage has the token when React
 * first reads it, and no redirect happens.
 */
async function loginAs(page, role = 'parent') {
  const tokens = loadTokens();
  const token = role === 'parent' ? tokens.parentToken : tokens.kidToken;

  if (!token) throw new Error(`No ${role} token found in /tmp/chorequest_e2e_tokens.json`);

  await page.addInitScript((t) => {
    localStorage.setItem('chorequest_access_token', t);
  }, token);

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Confirm we landed on the authenticated app.
  // Use the test's own timeout (no explicit cap) so slow CI/dev-server startups
  // don't trip a hard 10s wall after many prior tests have warmed up resources.
  await page.waitForSelector('nav');
}

export const test = base.extend({
  loginAsParent: async ({ page }, use) => {
    await loginAs(page, 'parent');
    await use(page);
  },
  loginAsKid: async ({ page }, use) => {
    await loginAs(page, 'kid');
    await use(page);
  },
});

export { expect } from '@playwright/test';
