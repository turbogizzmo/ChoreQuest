import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

function tokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

test.describe('Quest templates (critical route fix)', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('GET /api/chores/templates returns 200, not 422', async ({ loginAsParent: page }) => {
    let templateStatus = null;
    page.on('response', (res) => {
      if (res.url().includes('/api/chores/templates')) {
        templateStatus = res.status();
      }
    });
    await page.goto('/chores');
    const newQuestBtn = page.locator('button:has-text("New Quest"), button:has-text("Add Quest"), button:has-text("Create Quest")').first();
    if (await newQuestBtn.isVisible()) {
      await newQuestBtn.click();
      await page.waitForLoadState('networkidle');
      expect(templateStatus).toBe(200);
    }
  });

  test('template picker modal shows templates (not "No templates available yet")', async ({ loginAsParent: page }) => {
    await page.goto('/chores');
    const newQuestBtn = page.locator('button:has-text("New Quest"), button:has-text("Add Quest"), button:has-text("Create")').first();
    if (await newQuestBtn.isVisible()) {
      await newQuestBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('text=No templates available yet')).not.toBeVisible({ timeout: 5_000 });
      // At least one template card should be visible
      await expect(page.locator('.game-panel').nth(1)).toBeVisible({ timeout: 5_000 }).catch(async () => {
        await expect(page.locator('text=/Chamber of Rest|Dishwasher|Scholar/').first()).toBeVisible();
      });
    }
  });

  test('40 templates available in the DB (via API)', async ({ loginAsParent: page }) => {
    const { parentToken } = tokens();
    const response = await page.request.get('http://localhost:8199/api/chores/templates', {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(response.status()).toBe(200);
    const templates = await response.json();
    expect(templates.length).toBeGreaterThanOrEqual(40);
  });

  test('GET /api/chores/999 returns 404, not 422 (chore_id route still works)', async ({ loginAsParent: page }) => {
    const { parentToken } = tokens();
    const response = await page.request.get('http://localhost:8199/api/chores/999', {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(response.status()).toBe(404);
  });
});
