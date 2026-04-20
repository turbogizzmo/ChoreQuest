import { test, expect } from './fixtures.js';

test.describe('Calendar', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('calendar page loads without errors', async ({ loginAsParent: page }) => {
    const apiErrors = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/calendar') && res.status() >= 400) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    expect(apiErrors).toHaveLength(0);
  });

  test('week_start sent to API is always a Monday', async ({ loginAsParent: page }) => {
    const weekStarts = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/calendar?week_start=')) {
        const url = new URL(req.url());
        weekStarts.push(url.searchParams.get('week_start'));
      }
    });
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');

    for (const ws of weekStarts) {
      const day = new Date(ws + 'T00:00:00').getDay();
      expect(day).toBe(1); // 1 = Monday
    }
  });

  test('calendar renders day columns', async ({ loginAsParent: page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    // Should have day labels (Mon, Tue, etc. or date numbers)
    await expect(page.locator('text=/Mon|Tue|Wed|Thu|Fri|Sat|Sun/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('previous week navigation works', async ({ loginAsParent: page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    const prevBtn = page.locator('[aria-label="Previous week"], button:has-text("‹"), button:has-text("<")').first();
    if (await prevBtn.isVisible()) {
      await prevBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('text=/error/i')).not.toBeVisible();
    }
  });

  test('next week navigation works', async ({ loginAsParent: page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    const nextBtn = page.locator('[aria-label="Next week"], button:has-text("›"), button:has-text(">")').first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('text=/error/i')).not.toBeVisible();
    }
  });
});

test.describe('Calendar — kid dashboard week_start fix', () => {
  test('kid dashboard sends Monday as week_start', async ({ loginAsKid: page }) => {
    const weekStarts = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/calendar?week_start=')) {
        const url = new URL(req.url());
        weekStarts.push(url.searchParams.get('week_start'));
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    for (const ws of weekStarts) {
      const day = new Date(ws + 'T00:00:00').getDay();
      expect(day).toBe(1); // Must be Monday — the timezone bug fix
    }
    expect(weekStarts.length).toBeGreaterThan(0);
  });
});
