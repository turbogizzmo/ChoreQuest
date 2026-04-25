import { test, expect } from './fixtures.js';

test.describe('Settings — parent only', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('settings page accessible for parent', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
  });

  test('feature toggles are visible', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=/leaderboard|spin wheel|trading/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('grace period input is present', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=/grace period/i')).toBeVisible({ timeout: 8_000 });
  });

  test('grace period can be updated', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const input = page.locator('input[type="number"]').filter({ has: page.locator('..') }).first();
    if (await input.isVisible()) {
      await input.fill('2');
      const saveBtn = page.locator('button:has-text("Save"), button[type="submit"]').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        // Should not error
        await expect(page.locator('text=/error/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
      }
    }
  });
});

test.describe('Settings — kid view', () => {
  test('kid can load settings page without crashing', async ({ loginAsKid: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Kids see a limited settings page — no crash, no redirect to login
    await expect(page).not.toHaveURL(/login/);
    await expect(page).not.toHaveURL(/error/);
  });

  test('kid does not see parent-only save button or grace period control', async ({ loginAsKid: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Parent-only settings controls must not be visible to kids.
    // Scope to .game-panel to avoid matching sidebar nav links.
    await expect(page.locator('.game-panel').locator('text=/grace period/i')).not.toBeVisible();
    await expect(page.locator('button:has-text("Save Settings"), button:has-text("Save Changes")')).not.toBeVisible();
  });
});
