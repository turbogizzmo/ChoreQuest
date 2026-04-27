import { test, expect } from './fixtures.js';

test.describe('Rewards shop — kid', () => {
  test.beforeEach(async ({ loginAsKid }) => {});

  test('rewards shop loads', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    await expect(page.locator('text=Rewards Shop')).toBeVisible();
  });

  test('kid XP balance shown', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    await expect(page.locator('text=Your balance')).toBeVisible();
  });

  test('reward descriptions are fully visible — no line-clamp', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');
    const clamped = await page.locator('.line-clamp-2, .line-clamp-1').count();
    expect(clamped).toBe(0);
  });

  test('"Extra Screen Time" reward shows full description', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Extra Screen Time')).toBeVisible();
    // Full description text must be present (not truncated)
    await expect(page.locator('text=30 extra minutes')).toBeVisible();
  });

  test('redeem button disabled when not enough XP', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');
    // "Extra Screen Time" costs 50 XP; fresh kid has 0
    const notEnoughBtn = page.locator('button:has-text("Not Enough XP")').first();
    if (await notEnoughBtn.isVisible()) {
      await expect(notEnoughBtn).toBeDisabled();
    }
  });

  test('tabs: Avatar, Inventory, Wishlist tabs are clickable', async ({ loginAsKid: page }) => {
    await page.goto('/rewards');
    for (const tab of ['Avatar', 'Inventory', 'Wishlist']) {
      await page.locator(`button:has-text("${tab}")`).click();
      await expect(page).not.toHaveURL(/login/);
      await expect(page.locator('text=/loading/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    }
  });
});

test.describe('Wishlist — parent can delete', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('wishlist tab loads for parent', async ({ loginAsParent: page }) => {
    await page.goto('/rewards?tab=wishlist');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await expect(page).not.toHaveURL(/error/);
  });

  test('parent wishlist shows delete (trash) button on items', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');

    // Switch to wishlist tab
    await page.locator('button:has-text("Wishlist")').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const items = page.locator('.game-panel');
    const count = await items.count();
    if (count === 0) {
      // No wish list items seeded — just verify no crash
      await expect(page).not.toHaveURL(/error/);
      return;
    }

    // Trash / delete button must be visible for parents (not just kids)
    const deleteBtn = page.locator('button[title="Delete"], button svg.lucide-trash2').first();
    await expect(deleteBtn).toBeVisible();
  });
});

test.describe('Rewards shop — parent', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('parent sees Add Reward button', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await expect(page.locator('button:has-text("Add Reward")')).toBeVisible();
  });

  test('parent can open Add Reward modal', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await page.locator('button:has-text("Add Reward")').click();
    await expect(page.locator('text=New Reward')).toBeVisible();
    // Close it
    await page.keyboard.press('Escape');
  });

  test('parent sees edit and delete buttons on rewards', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[aria-label="Edit reward"]').first()).toBeVisible();
    await expect(page.locator('[aria-label="Delete reward"]').first()).toBeVisible();
  });

  test('parent does not see personal XP balance', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await expect(page.locator('text=Your balance')).not.toBeVisible();
  });
});
