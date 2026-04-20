import { test, expect } from './fixtures.js';

test.describe('Navigation — parent', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('home page loads', async ({ loginAsParent: page }) => {
    await expect(page).toHaveURL('/');
    await expect(page.locator('text=ChoreQuest').first()).toBeVisible();
  });

  test('Quests nav link works', async ({ loginAsParent: page }) => {
    await page.click('nav >> text=Quests');
    await expect(page).toHaveURL(/\/chores/);
    await expect(page).not.toHaveURL(/login/);
  });

  test('Rewards nav link works', async ({ loginAsParent: page }) => {
    await page.click('nav >> text=Rewards');
    await expect(page).toHaveURL(/\/rewards/);
  });

  test('Party nav link works', async ({ loginAsParent: page }) => {
    // Party may be in desktop nav or mobile More menu
    const partyBtn = page.locator('button:has-text("Party"), a:has-text("Party")').first();
    if (await partyBtn.isVisible()) {
      await partyBtn.click();
    } else {
      await page.locator('button:has-text("More")').click();
      await page.locator('text=Party').click();
    }
    await expect(page).toHaveURL(/\/party/);
  });

  test('Calendar accessible via More menu on mobile', async ({ loginAsParent: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const moreBtn = page.locator('button:has-text("More")');
    if (await moreBtn.isVisible()) {
      await moreBtn.click();
      await page.locator('text=Calendar').click();
      await expect(page).toHaveURL(/\/calendar/);
    }
  });

  test('back button navigates back', async ({ loginAsParent: page }) => {
    await page.click('nav >> text=Rewards');
    await expect(page).toHaveURL(/\/rewards/);
    await page.locator('[aria-label="Go back"]').click();
    await expect(page).toHaveURL('/');
  });

  test('logo click returns to home', async ({ loginAsParent: page }) => {
    await page.goto('/rewards');
    await page.locator('text=ChoreQuest').first().click();
    await expect(page).toHaveURL('/');
  });

  test('profile link in sidebar navigates to profile', async ({ loginAsParent: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('aside >> text=Parent').click();
    await expect(page).toHaveURL(/\/profile/);
  });
});

test.describe('Navigation — kid', () => {
  test.beforeEach(async ({ loginAsKid }) => {});

  test('kid home page loads quest board', async ({ loginAsKid: page }) => {
    await expect(page).toHaveURL('/');
    await expect(page.locator('text=Quest Board').first()).toBeVisible();
  });

  test('kid can navigate to rewards', async ({ loginAsKid: page }) => {
    await page.click('nav >> text=Rewards');
    await expect(page).toHaveURL(/\/rewards/);
  });

  test('Events nav item not shown for kid', async ({ loginAsKid: page }) => {
    await expect(page.locator('nav >> text=Events')).not.toBeVisible();
  });
});
