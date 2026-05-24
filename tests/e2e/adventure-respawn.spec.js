import { test, expect } from '@playwright/test';
import { pickRespawnPoint } from '../../frontend/src/game/systems/RespawnSystem.js';

test.describe('Adventure respawn safety', () => {
  test('falls back to default spawn when there are no active enemies', () => {
    const fallback = { x: 640, y: 640 };
    const point = pickRespawnPoint({
      enemies: [],
      fallback,
      candidates: [{ x: 200, y: 200 }],
    });

    expect(point).toEqual(fallback);
  });

  test('picks the candidate farthest from nearby enemies', () => {
    const fallback = { x: 640, y: 640 };
    const point = pickRespawnPoint({
      enemies: [{ x: 650, y: 650, active: true }],
      fallback,
      candidates: [
        { x: 224, y: 224 },
        { x: 1056, y: 1056 },
      ],
    });

    expect(point).toEqual({ x: 224, y: 224 });
  });

  test('ignores inactive enemies when picking a spawn point', () => {
    const fallback = { x: 640, y: 640 };
    const point = pickRespawnPoint({
      enemies: [
        { x: 224, y: 224, active: false },
        { x: 630, y: 630, active: true },
      ],
      fallback,
      candidates: [{ x: 224, y: 224 }],
    });

    expect(point).toEqual({ x: 224, y: 224 });
  });
});
