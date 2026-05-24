// ChestSystem.js — Treasure chest loot drops on enemy defeat.
//
// 20% drop chance per kill (CHEST_DROP_CHANCE).
// Chest auto-despawns after 10 s if the player ignores it.
// Collecting grants random coin + XP reward from CHEST_REWARDS.
// Emits 'chestCollect' event with { coins, xp } on pickup.

import { CHEST_DROP_CHANCE, CHEST_REWARDS } from '../data/WorldData.js';

const DESPAWN_MS = 10_000; // ms until an uncollected chest fades out

export class ChestSystem {
  constructor(scene) {
    this.scene   = scene;
    this._chests = []; // { sprite, overlap, timer }
  }

  // Call on enemy defeat. Returns true if a chest was spawned.
  trySpawn(x, y) {
    if (Math.random() > CHEST_DROP_CHANCE) return false;
    this._spawnChest(x, y);
    return true;
  }

  _spawnChest(x, y) {
    const scene  = this.scene;

    // Static physics sprite so collision detection is cheap
    const sprite = scene.physics.add.staticSprite(x, y - 8, 'chest', 0)
      .setScale(1.5).setDepth(9);
    sprite.refreshBody();
    if (sprite.body) sprite.body.enable = false;

    // Pop-in entrance: start tiny + invisible, expand to full size
    sprite.setAlpha(0).setScale(0.2);
    let pulseTween = null;
    scene.tweens.add({
      targets: sprite,
      alpha: 1, scaleX: 1.5, scaleY: 1.5,
      duration: 220, ease: 'Back.easeOut',
      onComplete: () => {
        if (!sprite.active) return;
        sprite.setScale(1.5);
        sprite.refreshBody();
        if (sprite.body) sprite.body.enable = true;
        pulseTween = scene.tweens.add({
          targets: sprite,
          alpha: 0.82,
          yoyo: true,
          repeat: -1,
          duration: 520,
          ease: 'Sine.easeInOut',
        });
      },
    });

    // Player overlap → collect
    const overlap = scene.physics.add.overlap(scene.player, sprite, () => {
      this._collectChest(sprite, overlap, pulseTween);
    });

    // Auto-despawn timer
    const timer = scene.time.delayedCall(DESPAWN_MS, () => {
      this._removeChest(sprite, overlap, pulseTween);
    });

    this._chests.push({ sprite, overlap, pulseTween, timer });
  }

  _collectChest(sprite, overlap, pulseTween) {
    if (!sprite.active) return;
    sprite.setActive(false);

    this._cleanup(sprite, overlap, pulseTween);

    // Pick reward
    const reward = CHEST_REWARDS[Math.floor(Math.random() * CHEST_REWARDS.length)];

    // Switch to open-chest frame, then burst + fade
    sprite.setFrame(1);
    this.scene.tweens.add({
      targets: sprite, scaleX: 2, scaleY: 2, alpha: 0,
      duration: 300, ease: 'Power1',
      onComplete: () => sprite.destroy(),
    });

    // Coin sparkle burst — 6 yellow pixels radiate outward
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const sq = this.scene.add.rectangle(sprite.x, sprite.y, 5, 5, 0xfcd860, 1).setDepth(13);
      this.scene.tweens.add({
        targets: sq,
        x: sprite.x + Math.cos(angle) * 30,
        y: sprite.y + Math.sin(angle) * 30,
        alpha: 0, scaleX: 0.3, scaleY: 0.3,
        duration: 320, ease: 'Power1',
        onComplete: () => sq.destroy(),
      });
    }

    // Tell WorldScene about the reward
    this.scene.events.emit('chestCollect', reward);
  }

  _removeChest(sprite, overlap, pulseTween) {
    if (!sprite.active) return;
    sprite.setActive(false);

    this._cleanup(sprite, overlap, pulseTween);

    // Shrink + fade out
    this.scene.tweens.add({
      targets: sprite, alpha: 0, scaleY: 0.2,
      duration: 280, ease: 'Power2',
      onComplete: () => sprite.destroy(),
    });
  }

  // Shared teardown: kill timer, remove overlap, kill tween, remove from list
  _cleanup(sprite, overlap, pulseTween) {
    this._chests = this._chests.filter((c) => {
      if (c.sprite === sprite) {
        c.timer.remove(false);
        return false;
      }
      return true;
    });
    try { pulseTween?.stop(); pulseTween?.destroy?.(); } catch (_) {}
    try { if (overlap?.destroy) { overlap.destroy(); } else { this.scene.physics.world.removeCollider(overlap); } } catch (_) {}
  }

  destroy() {
    this._chests.forEach(({ sprite, overlap, pulseTween, timer }) => {
      try { timer.remove(false); } catch (_) {}
      try { pulseTween?.stop(); } catch (_) {}
      try { if (overlap?.destroy) { overlap.destroy(); } else { this.scene.physics.world.removeCollider(overlap); } } catch (_) {}
      try { sprite.destroy(); } catch (_) {}
    });
    this._chests = [];
  }
}
