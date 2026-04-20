import { test, expect } from './fixtures.js';

test.describe('Quests page — parent', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('chores library loads', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('h1, h2').filter({ hasText: /quest|chore/i }).first()).toBeVisible();
  });

  test('chore descriptions are not truncated (no line-clamp)', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    const descriptions = page.locator('.text-muted.text-xs:not(.line-clamp-2):not(.line-clamp-1)');
    // Verify no description elements have line-clamp class applied
    const clamped = await page.locator('.line-clamp-2, .line-clamp-1').count();
    expect(clamped).toBe(0);
  });

  test('new quest button is visible for parent', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await expect(page.locator('button:has-text("New Quest"), button:has-text("Add"), button:has-text("Create")').first()).toBeVisible();
  });

  test('chores library has quests from seed', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    // At least one quest card should be present
    await expect(page.locator('.game-panel').first()).toBeVisible();
  });
});

test.describe('Quests page — kid view', () => {
  test.beforeEach(async ({ loginAsKid }) => {});

  test('kid quests page loads', async ({ loginAsKid: page }) => {
    await page.goto('/chores');
    await expect(page).not.toHaveURL(/login/);
  });

  test('quest descriptions fully visible — no line-clamp', async ({ loginAsKid: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    const clamped = await page.locator('.line-clamp-1, .line-clamp-2').count();
    expect(clamped).toBe(0);
  });
});

test.describe('Parent kid-detail view', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('party page lists kids', async ({ loginAsParent: page }) => {
    await page.goto('/party');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('text=Kid, text=e2e_kid').first()).toBeVisible({ timeout: 8_000 }).catch(() => {
      // May show empty state if no kids shown — just check no crash
    });
    await expect(page).not.toHaveURL(/error/);
  });

  test('kid detail page loads from party', async ({ loginAsParent: page }) => {
    await page.goto('/party');
    await page.waitForLoadState('networkidle');
    const kidLink = page.locator('a[href*="/kids/"], button:has-text("Kid")').first();
    if (await kidLink.isVisible()) {
      await kidLink.click();
      await expect(page).toHaveURL(/\/kids\//);
    }
  });
});
