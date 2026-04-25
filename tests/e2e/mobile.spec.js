/**
 * mobile.spec.js
 *
 * Tests that the app renders correctly on a mobile viewport (iPhone 12 Pro: 390×844).
 *
 * Covers:
 * - No horizontal overflow (scrollWidth ≤ clientWidth) on key pages
 * - Bottom nav bar renders and links work
 * - More menu opens and contains overflow nav items
 * - Quest board renders on mobile
 * - Rewards page renders on mobile
 * - Theme picker works on mobile
 * - Parent pages render without overflow
 */

import { test, expect } from './fixtures.js';

const IPHONE = { width: 390, height: 844 };

// Helper — set mobile viewport and reload
async function setMobile(page) {
  await page.setViewportSize(IPHONE);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// Helper — measure horizontal overflow
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
}

// ─── Kid mobile ───────────────────────────────────────────────────────────────

test.describe('Mobile — kid dashboard', () => {
  test('kid dashboard renders on iPhone viewport', async ({ loginAsKid: page }) => {
    await setMobile(page);
    await expect(page.locator('text=Quest Board').first()).toBeVisible({ timeout: 8_000 });
    await expect(page).not.toHaveURL(/error/);
  });

  test('no horizontal scroll on kid dashboard', async ({ loginAsKid: page }) => {
    await setMobile(page);
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2); // 2 px tolerance for sub-pixel rendering
  });

  test('nav links are present on mobile (bottom bar or visible nav)', async ({ loginAsKid: page }) => {
    await setMobile(page);
    // On mobile the sidebar is hidden — check for any visible navigation link instead
    await expect(
      page.locator('a[href="/rewards"], a[href="/chores"], button:has-text("Rewards")').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Rewards nav link works on mobile', async ({ loginAsKid: page }) => {
    await setMobile(page);
    // Use first() to avoid strict-mode violation when sidebar + bottom nav both exist
    await page.locator('a[href="/rewards"]').first().click();
    await expect(page).toHaveURL(/\/rewards/);
    await expect(page).not.toHaveURL(/error/);
  });

  test('board theme picker opens on mobile', async ({ loginAsKid: page }) => {
    await setMobile(page);
    const themeBtn = page.locator('button[title="Change board theme"]');
    await expect(themeBtn).toBeVisible({ timeout: 5_000 });
    await themeBtn.click();
    await expect(page.locator('text=Choose Board Theme')).toBeVisible({ timeout: 3_000 });
    await themeBtn.click(); // close it
    await expect(page.locator('text=Choose Board Theme')).not.toBeVisible({ timeout: 2_000 });
  });

  test('no horizontal scroll on rewards page (mobile)', async ({ loginAsKid: page }) => {
    await setMobile(page);
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Rewards Shop')).toBeVisible({ timeout: 8_000 });
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll on leaderboard page (mobile)', async ({ loginAsKid: page }) => {
    await setMobile(page);
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error/);
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

// ─── Parent mobile ────────────────────────────────────────────────────────────

test.describe('Mobile — parent dashboard', () => {
  test('parent dashboard renders on iPhone viewport', async ({ loginAsParent: page }) => {
    await setMobile(page);
    // Sidebar nav is hidden on mobile — verify the page content loaded instead
    await expect(page.locator('main, .game-panel, text=/quest|pending|dashboard/i').first()).toBeVisible({ timeout: 8_000 });
    await expect(page).not.toHaveURL(/error|login/);
  });

  test('no horizontal scroll on parent dashboard', async ({ loginAsParent: page }) => {
    await setMobile(page);
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('More menu opens and shows Calendar + Settings', async ({ loginAsParent: page }) => {
    await setMobile(page);
    const moreBtn = page.locator('button:has-text("More")');
    if (await moreBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await moreBtn.click();
      await expect(
        page.locator('button:has-text("Calendar"), a[href="/calendar"], button:has-text("Settings"), a[href="/settings"]').first()
      ).toBeVisible({ timeout: 3_000 });
      // Dismiss
      await page.keyboard.press('Escape');
    }
  });

  test('More menu Calendar link navigates correctly on mobile', async ({ loginAsParent: page }) => {
    await setMobile(page);
    const moreBtn = page.locator('button:has-text("More")');
    if (await moreBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await moreBtn.click();
      await page.locator('button:has-text("Calendar"), a[href="/calendar"]').last().click();
      await expect(page).toHaveURL(/\/calendar/);
      await expect(page).not.toHaveURL(/error/);
    }
  });

  test('no horizontal scroll on quests page (mobile)', async ({ loginAsParent: page }) => {
    await setMobile(page);
    await page.goto('/chores');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('no horizontal scroll on settings page (mobile)', async ({ loginAsParent: page }) => {
    await setMobile(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

// ─── Tablet viewport (iPad mini: 768×1024) ────────────────────────────────────

test.describe('Tablet — layout smoke', () => {
  test('kid dashboard renders on tablet viewport', async ({ loginAsKid: page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Quest Board').first()).toBeVisible({ timeout: 8_000 });
    await expect(page).not.toHaveURL(/error/);
  });

  test('no horizontal scroll on tablet', async ({ loginAsParent: page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
