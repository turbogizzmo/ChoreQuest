import { test, expect } from './fixtures.js';

// Keep in sync with frontend/src/game/engine/WorldScene.js::_showPauseMenu
// where Exit Adventure button is placed at (w / 2, h / 2 + 20).
const PAUSE_EXIT_BUTTON_OFFSET_Y = 20;

test.describe('Adventure mode pause menu', () => {
  test('pause menu exit button returns to dashboard', async ({ loginAsKid: page }) => {
    await page.goto('/adventure');
    await expect(page.getByText('⚔ Adventure Mode')).toBeVisible({ timeout: 10_000 });

    const canvas = page.locator('#adventure-game-container canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await canvas.click();

    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      box.x + (box.width / 2),
      box.y + (box.height / 2) + PAUSE_EXIT_BUTTON_OFFSET_Y,
    );

    await expect(page).toHaveURL('http://localhost:5174/');
  });
});
