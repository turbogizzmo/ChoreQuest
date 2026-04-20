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
 * loginAs — injects auth token into localStorage and navigates to /
 */
async function loginAs(page, role = 'parent') {
  const tokens = loadTokens();
  const token = role === 'parent' ? tokens.parentToken : tokens.kidToken;

  await page.goto('/');
  await page.evaluate((t) => {
    localStorage.setItem('chorequest_access_token', t);
  }, token);
  await page.goto('/');
  // Wait for the nav to confirm we're logged in
  await page.waitForSelector('nav', { timeout: 10_000 });
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
