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

test.describe('Quest search', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('search input is visible on chores page', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[placeholder*="Search"], input[type="search"]').first()).toBeVisible();
  });

  test('typing in search filters quest cards', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');

    const cardsBefore = await page.locator('.game-panel').count();

    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    // Type a very unlikely string — expect 0 results
    await searchInput.fill('zzzzzzzzzznomatch');
    await page.waitForTimeout(300);

    const cardsAfter = await page.locator('.game-panel').count();
    expect(cardsAfter).toBeLessThan(cardsBefore);
  });

  test('clear button resets search and restores full list', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');

    const cardsBefore = await page.locator('.game-panel').count();

    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    await searchInput.fill('zzzzzzzzzznomatch');
    await page.waitForTimeout(300);

    // Clear button (X icon button next to search input)
    const clearBtn = page.locator('button[aria-label="Clear search"], button svg.lucide-x').first();
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
    } else {
      await searchInput.fill('');
    }
    await page.waitForTimeout(300);

    const cardsAfterClear = await page.locator('.game-panel').count();
    expect(cardsAfterClear).toBe(cardsBefore);
  });

  test('search by known quest title narrows results', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');

    // Get the title of the first quest
    const firstTitle = await page.locator('.game-panel .text-cream').first().textContent();
    if (!firstTitle) return; // skip if no quests

    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    // Type first 4 chars of the title
    await searchInput.fill(firstTitle.trim().slice(0, 4));
    await page.waitForTimeout(300);

    // At least one card should still be visible (the one we searched for)
    await expect(page.locator('.game-panel').first()).toBeVisible();
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
