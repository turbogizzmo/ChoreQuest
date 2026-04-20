import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

function tokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
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

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[placeholder*="sername"]').first().fill('e2e_parent');
    await page.locator('input[type="password"]').first().fill('wrongpassword');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();
    // Should stay on login and show some error
    await expect(page.locator('text=/invalid|incorrect|wrong|error/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('logged-in user sees nav', async ({ page }) => {
    const { parentToken } = tokens();
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('chorequest_access_token', t), parentToken);
    await page.goto('/');
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('profile page accessible when logged in', async ({ page }) => {
    const { parentToken } = tokens();
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('chorequest_access_token', t), parentToken);
    await page.goto('/profile');
    await expect(page).not.toHaveURL(/login/);
  });
});
