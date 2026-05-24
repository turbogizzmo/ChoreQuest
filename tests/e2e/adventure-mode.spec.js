import { test, expect } from './fixtures.js';

test.describe('Adventure mode pause menu', () => {
  test('pause menu exit button returns to dashboard', async ({ loginAsKid: page }) => {
    await page.goto('/adventure');
    await expect(page.getByText('⚔ Adventure Mode')).toBeVisible({ timeout: 10_000 });

    const canvas = page.locator('#adventure-game-container canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await canvas.click();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2) + 20);

    await expect(page).toHaveURL(/\/$/);
  });
});
