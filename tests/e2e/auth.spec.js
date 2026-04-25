import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

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

// ─── Unknown username ─────────────────────────────────────────────────────────

test.describe('Authentication — invalid credentials', () => {
  test('unknown username shows error and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[placeholder*="sername"]').first().fill('ghost_user_xyz_999');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/login/);
    // Error div or message must appear
    await expect(
      page.locator('.text-crimson, text=/invalid|incorrect|not found/i').first()
    ).toBeVisible({ timeout: 6_000 });
  });

  test('empty form does not navigate away', async ({ page }) => {
    await page.goto('/login');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
    await expect(page).toHaveURL(/login/);
  });
});

// ─── Protected route redirects ────────────────────────────────────────────────

test.describe('Authentication — unauthenticated redirect', () => {
  async function visitUnauthenticated(page, path) {
    // Clear any stored token before navigating
    await page.addInitScript(() => localStorage.removeItem('chorequest_access_token'));
    await page.context().clearCookies();
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  for (const route of ['/chores', '/rewards', '/calendar', '/settings', '/profile']) {
    test(`${route} redirects unauthenticated user to /login`, async ({ page }) => {
      await visitUnauthenticated(page, route);
      await expect(page).toHaveURL(/login/, { timeout: 6_000 });
    });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────

test.describe('Authentication — logout', () => {
  test('POST /api/auth/logout returns 2xx', async ({ page }) => {
    const { parentToken } = tokens();
    const res = await page.request.post(`${BASE}/api/auth/logout`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(res.status()).toBeLessThan(300);
  });
});

// ─── Registration ─────────────────────────────────────────────────────────────

test.describe('Registration page', () => {
  test('register page renders with password field', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 8_000 });
  });

  test('register page has a link back to login', async ({ page }) => {
    await page.goto('/register');
    const loginLink = page.locator('a:has-text("Sign In"), a:has-text("Login"), button:has-text("Sign In")').first();
    await expect(loginLink).toBeVisible({ timeout: 5_000 });
  });

  test('duplicate username registration shows error', async ({ page }) => {
    const { parentUsername } = tokens();
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    const usernameInput = page.locator('input[name="username"], input[placeholder*="sername"]').first();
    await usernameInput.fill(parentUsername); // already registered user
    await page.locator('input[type="password"]').first().fill('password123');

    // Fill display name if visible
    const displayInput = page.locator('input[name="display_name"], input[placeholder*="name" i]').first();
    if (await displayInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await displayInput.fill('Dupe Test');
    }

    await page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up"), button:has-text("Create")').first().click();
    await page.waitForLoadState('networkidle');

    // Must stay on register and show an error (username taken)
    await expect(page).toHaveURL(/register/, { timeout: 5_000 });
    await expect(
      page.locator('text=/taken|exists|already|conflict/i').first()
    ).toBeVisible({ timeout: 6_000 });
  });
});
