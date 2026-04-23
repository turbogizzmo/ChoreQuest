import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

function tokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

/**
 * Inject token via addInitScript so it's present before the first page
 * script runs — avoids the "Execution context was destroyed" race condition
 * that plagued the old evaluate()-after-goto() pattern.
 */
async function injectToken(page, token) {
  await page.addInitScript((t) => {
    localStorage.setItem('chorequest_access_token', t);
  }, token);
}

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/login|\/$/);
    await expect(page.locator('input[type="text"], input[name="username"]').first()).toBeVisible();
  });

  test('parent can log in with username + password', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[placeholder*="sername"]').first().fill('e2e_parent');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();
    await page.waitForURL(/\/$/, { timeout: 10_000 });
    await expect(page.locator('text=ChoreQuest').first()).toBeVisible();
  });

  test('kid can log in with username + password', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[placeholder*="sername"]').first().fill('e2e_kid');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();
    await page.waitForURL(/\/$/, { timeout: 10_000 });
    await expect(page.locator('text=ChoreQuest').first()).toBeVisible();
  });

  test('wrong password shows inline error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[placeholder*="sername"]').first().fill('e2e_parent');
    await page.locator('input[type="password"]').first().fill('definitely_wrong_password');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();

    // Wait for the POST to complete before asserting
    await page.waitForLoadState('networkidle');

    // Login.jsx renders an inline crimson error div for bad credentials
    // (not a toast — the login page has its own local error state)
    await expect(page.locator('.text-crimson').first()).toBeVisible({ timeout: 8_000 });
    // Must stay on the login page
    await expect(page).toHaveURL(/login/);
  });

  test('logged-in user sees nav', async ({ page }) => {
    const { parentToken } = tokens();
    await injectToken(page, parentToken);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('profile page accessible when logged in', async ({ page }) => {
    const { parentToken } = tokens();
    await injectToken(page, parentToken);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
  });
});
