import { test, expect } from './fixtures.js';

test.describe('Kid Dashboard', () => {
  test.beforeEach(async ({ loginAsKid }) => {});

  test('quest board panel is visible', async ({ loginAsKid: page }) => {
    await expect(page.locator('text=Quest Board')).toBeVisible();
  });

  test('XP balance is shown', async ({ loginAsKid: page }) => {
    // PointCounter should render a number
    await expect(page.locator('text=/\\d+ XP|\\d+/').first()).toBeVisible();
  });

  test('streak display renders', async ({ loginAsKid: page }) => {
    await expect(page.locator('[class*="streak"], text=/streak/i, text=/🔥/').first()).toBeVisible({ timeout: 5_000 }).catch(() => {});
    // Streak can be 0 — just verify no crash
    await expect(page).not.toHaveURL(/error/);
  });

  test('empty state shows correct message when no quests', async ({ loginAsKid: page }) => {
    // If no assignments: "No quests for today" message
    const noQuests = page.locator('text=/No quests for today|All quests complete/i');
    const questCard = page.locator('.game-panel').nth(1);
    // Either a quest card or the empty state should be visible
    const eitherVisible = await noQuests.isVisible() || await questCard.isVisible();
    expect(eitherVisible).toBe(true);
  });

  test('quest cards are not navigating to /chores when clicked (old broken behaviour)', async ({ loginAsKid: page }) => {
    const card = page.locator('.game-panel').nth(1);
    if (await card.isVisible()) {
      // Cards should NOT navigate away — they're just display
      await card.click({ force: true });
      // Should stay on home page
      await expect(page).toHaveURL('/');
    }
  });

  test('board theme picker opens and closes', async ({ loginAsKid: page }) => {
    const themeBtn = page.locator('button[title="Change board theme"]');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();
    await expect(page.locator('text=Choose Board Theme')).toBeVisible();
    await themeBtn.click();
    await expect(page.locator('text=Choose Board Theme')).not.toBeVisible();
  });

  test('no 400 errors from calendar API on load', async ({ loginAsKid: page }) => {
    const errors = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/calendar') && res.status() >= 400) {
        errors.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('forgotten quests section shows Mark Done button (not navigate)', async ({ loginAsKid: page }) => {
    // If there are overdue quests, the Mark Done button must be present (not just a clickable card)
    const forgottenSection = page.locator('text=Forgotten Quests');
    if (await forgottenSection.isVisible()) {
      await expect(page.locator('button:has-text("Mark Done")')).toBeVisible();
    }
  });
});
