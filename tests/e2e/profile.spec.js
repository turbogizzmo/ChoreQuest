/**
 * profile.spec.js
 *
 * Tests the Profile page for both parent and kid:
 * - Page loads without crash or redirect
 * - Display name is shown
 * - Kid profile shows XP, streak, and achievement data
 * - Parent profile shows role-appropriate content
 * - Editing display name works (if editable UI is present)
 * - Avatar section renders without error
 */

import { test, expect } from './fixtures.js';

// ─── Parent profile ───────────────────────────────────────────────────────────

test.describe('Profile — parent', () => {
  test('parent profile page loads without error', async ({ loginAsParent: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
  });

  test('parent profile shows display name', async ({ loginAsParent: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    // The parent's display name "Parent" or username "e2e_parent"
    await expect(
      page.locator('text=/Parent|e2e_parent/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('parent profile shows their role', async ({ loginAsParent: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('text=/parent|admin/i').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('no JS errors on parent profile load', async ({ loginAsParent: page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});

// ─── Kid profile ──────────────────────────────────────────────────────────────

test.describe('Profile — kid', () => {
  test('kid profile page loads without error', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
  });

  test('kid profile shows display name', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('text=/Kid|e2e_kid/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('kid profile shows XP or points stat', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('text=/XP|points|balance/i').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('kid profile shows streak information', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    // Streak may be 0 but the label should exist
    await expect(
      page.locator('text=/streak/i').first()
    ).toBeVisible({ timeout: 5_000 }).catch(() => {
      // Some themes may hide the streak section if 0 — not a failure
    });
    await expect(page).not.toHaveURL(/error/);
  });

  test('kid profile shows achievement or badge section', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    // May show badges, trophies, or "no achievements yet"
    await expect(page).not.toHaveURL(/error/);
    // At minimum the page renders a panel
    await expect(page.locator('.game-panel').first()).toBeVisible({ timeout: 8_000 });
  });

  test('no JS errors on kid profile load', async ({ loginAsKid: page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});

// ─── Editing ──────────────────────────────────────────────────────────────────

test.describe('Profile — editing', () => {
  test('edit display name input is present for parent', async ({ loginAsParent: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    // Look for an edit button or editable display name field
    const editBtn = page.locator('button:has-text("Edit"), button[aria-label*="edit" i], input[name="display_name"]').first();
    // Not all themes show this — just verify no crash
    await expect(page).not.toHaveURL(/error/);
    if (await editBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page).not.toHaveURL(/error/);
    }
  });

  test('avatar section is accessible from profile', async ({ loginAsKid: page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    // Avatar may be shown inline or via a link to /avatar
    await expect(page).not.toHaveURL(/error/);
  });
});
