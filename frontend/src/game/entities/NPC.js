// NPC.js — Friendly shopkeeper NPC placed near the Reward Castle.
//
// Idle blink animation (2-frame: eyes open / eyes closed).
// When the player walks within PROX_TILES tiles, a dialogue bubble appears
// showing a random tip from DIALOGUE_LINES, auto-hides after 3.5 s.

import { TILE_SIZE } from '../data/WorldData.js';

const PROX_TILES = 3;      // tile radius for dialogue trigger
const PROX_PX    = PROX_TILES * TILE_SIZE;
const TEXT_METRICS_READY_DELAY_MS = 32;

const DIALOGUE_LINES = [
  'Complete chores for XP!',
  'Buy weapons at the castle!',
  'Defeat bosses for big rewards!',
  'Chore Surge gives 2× XP!',
  'Combo hits multiply coins!',
  'Walk into portals for quests!',
  'Bosses respawn every 24 hours!',
  'Chests drop randomly on kills!',
];

export class NPC {
  constructor(scene, tileX, tileY) {
    this.scene = scene;
    const px = tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tileY * TILE_SIZE + TILE_SIZE / 2;

    // ── Sprite ────────────────────────────────────────────────────────────
    this.sprite = scene.add.sprite(px, py, 'npc_shopkeeper', 0)
      .setScale(2.5).setDepth(10).setOrigin(0.5, 1);

    if (!scene.anims.exists('npc_idle')) {
      scene.anims.create({
        key: 'npc_idle',
        frames: [
          { key: 'npc_shopkeeper', frame: 0 }, // eyes open  ×3 ticks
          { key: 'npc_shopkeeper', frame: 0 },
          { key: 'npc_shopkeeper', frame: 0 },
          { key: 'npc_shopkeeper', frame: 1 }, // blink
        ],
        frameRate: 4,
        repeat: -1,
      });
    }
    this.sprite.play('npc_idle');

    // ── Name tag (always visible) ──────────────────────────────────────────
    this._nameTag = scene.add.text(
      px, py - this.sprite.displayHeight - 2,
      'Keeper',
      {
        fontSize: '7px', fontFamily: 'monospace', color: '#fcd860',
        stroke: '#000', strokeThickness: 2, resolution: 2,
      },
    ).setDepth(11).setOrigin(0.5, 1);

    // ── Dialogue state ────────────────────────────────────────────────────
    this._bubble        = null;
    this._bubbleText    = null;
    this._bubbleVisible = false;
    this._lineIdx       = Math.floor(Math.random() * DIALOGUE_LINES.length);
    this._metricsTimer  = null;
    this._hidingTimer   = null;
  }

  // Call from WorldScene.update() with the player sprite.
  update(player) {
    const dx   = player.x - this.sprite.x;
    const dy   = player.y - this.sprite.y;
    const near = dx * dx + dy * dy < PROX_PX * PROX_PX;

    if (near && !this._bubbleVisible) {
      this._showBubble();
    } else if (!near && this._bubbleVisible) {
      this._hideBubble();
    }
  }

  _showBubble() {
    if (this._bubbleVisible) return;
    this._bubbleVisible = true;

    const scene = this.scene;
    const sx    = this.sprite.x;
    const sy    = this.sprite.y - this.sprite.displayHeight;

    const line  = DIALOGUE_LINES[this._lineIdx % DIALOGUE_LINES.length];
    this._lineIdx++;

    // Text element
    const textEl = scene.add.text(sx, sy - 20, line, {
      fontSize: '7px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000', strokeThickness: 2, resolution: 2,
      wordWrap: { width: 96, useAdvancedWrap: true },
    }).setDepth(20).setOrigin(0.5, 1);

    const bubble = scene.add.graphics().setDepth(19);

    this._bubble     = bubble;
    this._bubbleText = textEl;

    // Fade in
    bubble.setAlpha(0);
    textEl.setAlpha(0);
    // Wait one render tick for Phaser to populate text metrics before sizing the bubble.
    this._metricsTimer = scene.time.delayedCall(TEXT_METRICS_READY_DELAY_MS, () => {
      this._metricsTimer = null;
      if (this._bubble !== bubble || !textEl.active) return;
      const pad = 6;
      const bw  = textEl.width  + pad * 2;
      const bh  = textEl.height + pad * 2;
      const bx  = sx - bw / 2;
      const by  = sy - 22 - bh;

      bubble.clear();
      bubble.fillStyle(0x0d0d1e, 0.88);
      bubble.fillRoundedRect(bx, by, bw, bh, 4);
      bubble.lineStyle(1, 0xfcd860, 0.9);
      bubble.strokeRoundedRect(bx, by, bw, bh, 4);
      // Tail pointing down toward NPC head
      bubble.fillStyle(0x0d0d1e, 0.88);
      bubble.fillTriangle(sx - 5, sy - 22, sx + 5, sy - 22, sx, sy - 14);
      bubble.lineStyle(0, 0, 0); // clear line style for fill

      scene.tweens.add({ targets: [bubble, textEl], alpha: 1, duration: 200 });
    });

    // Auto-hide after 3.5 s
    this._hidingTimer = scene.time.delayedCall(3500, () => {
      if (this._bubbleVisible) this._hideBubble();
    });
  }

  _hideBubble() {
    if (!this._bubbleVisible) return;
    this._bubbleVisible = false;

    if (this._hidingTimer) {
      this._hidingTimer.remove(false);
      this._hidingTimer = null;
    }
    if (this._metricsTimer) {
      this._metricsTimer.remove(false);
      this._metricsTimer = null;
    }

    const targets = [this._bubble, this._bubbleText].filter(Boolean);
    this.scene.tweens.add({
      targets, alpha: 0, duration: 200,
      onComplete: () => {
        targets.forEach((t) => { try { t.destroy(); } catch (_) {} });
        this._bubble     = null;
        this._bubbleText = null;
      },
    });
  }

  setPaused(paused) {
    if (this._metricsTimer) this._metricsTimer.paused = paused;
    if (this._hidingTimer) this._hidingTimer.paused = paused;
  }

  destroy() {
    this._metricsTimer?.remove(false);
    this._hidingTimer?.remove(false);
    try { this._bubble?.destroy(); }     catch (_) {}
    try { this._bubbleText?.destroy(); } catch (_) {}
    try { this._nameTag?.destroy(); }    catch (_) {}
    try { this.sprite?.destroy(); }      catch (_) {}
  }
}
