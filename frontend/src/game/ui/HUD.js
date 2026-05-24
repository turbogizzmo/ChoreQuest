// In-game HUD: hearts, XP bar, level, coin count, minimap indicator.
// All elements are fixed to the camera (setScrollFactor(0)).

import Phaser from 'phaser';
import { xpForLevel, levelFromXp } from '../data/WorldData.js';

const MAX_HEARTS   = 5;
const HUD_DEPTH    = 100;
const PADDING      = 8;
const HEART_SCALE  = 3;            // 8px source × 3 = 24px display
const HEART_SIZE   = 8 * HEART_SCALE;
const HEART_GAP    = 3;

export class HUD {
  constructor(scene) {
    this.scene   = scene;
    this.hearts  = [];
    this.xpMask  = null;
    this._buildHUD();
  }

  _buildHUD() {
    const scene = this.scene;
    const cam   = scene.cameras.main;
    const W     = cam.width;

    const xpY  = PADDING + HEART_SIZE + 6;
    const BAR_W = 128;
    const HUD_BG_W = PADDING + MAX_HEARTS * (HEART_SIZE + HEART_GAP) + 4;
    const HUD_BG_H = xpY + 12 + 6;

    // ── Dark background strip for top-left HUD ───────────────────────
    const bgLeft = scene.add.graphics();
    bgLeft.fillStyle(0x000000, 0.55);
    bgLeft.fillRoundedRect(2, 2, HUD_BG_W + 52, HUD_BG_H, 5);
    bgLeft.setScrollFactor(0).setDepth(HUD_DEPTH - 1);

    // ── Hearts (top-left) ────────────────────────────────────────────
    for (let i = 0; i < MAX_HEARTS; i++) {
      const hx = PADDING + i * (HEART_SIZE + HEART_GAP);
      const hy = PADDING;
      const empty = scene.add.image(hx, hy, 'heart', 1)
        .setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0).setScale(HEART_SCALE);
      const full  = scene.add.image(hx, hy, 'heart', 0)
        .setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0).setScale(HEART_SCALE);
      this.hearts.push({ empty, full });
    }

    // ── XP bar (below hearts) ────────────────────────────────────────
    scene.add.image(PADDING, xpY, 'xpbar_bg')
      .setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0).setScale(1.25, 1.5);

    this.xpFill = scene.add.image(PADDING, xpY, 'xpbar_fill')
      .setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0).setScale(1.25, 1.5);

    this.xpFill.setCrop(0, 0, 0, 8);

    // XP label (centered on bar)
    this.xpLabel = scene.add.text(PADDING + BAR_W * 1.25 / 2, xpY + 6, 'XP 0', {
      fontSize: '9px',
      fontFamily: 'monospace',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 2).setOrigin(0.5);

    // ── Level badge (right of XP bar) ────────────────────────────────
    this.levelLabel = scene.add.text(PADDING + BAR_W * 1.25 + 6, xpY + 1, 'LV 1', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#fcd860',
      stroke: '#000000',
      strokeThickness: 4,
      resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH);

    // ── Coin counter (top-right) ──────────────────────────────────────
    const coinX = W - PADDING - 48;
    const bgRight = scene.add.graphics();
    bgRight.fillStyle(0x000000, 0.55);
    bgRight.fillRoundedRect(coinX - 4, 2, 60, 28, 5);
    bgRight.setScrollFactor(0).setDepth(HUD_DEPTH - 1);

    // Coin animation
    if (!scene.anims.exists('coin_spin')) {
      scene.anims.create({
        key: 'coin_spin',
        frames: scene.anims.generateFrameNumbers('coin', { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    const coinAnim = scene.add.sprite(coinX, PADDING + 2, 'coin')
      .setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0).setScale(2.5);
    coinAnim.play('coin_spin');

    this.coinLabel = scene.add.text(coinX + 24, PADDING + 8, '0', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#fcd860',
      stroke: '#000000',
      strokeThickness: 4,
      resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0, 0.5);

    // ── Touch action buttons (bottom) ────────────────────────────────
    if (scene.sys.game.device.input.touch) {
      this._buildTouchControls();
    }
  }

  _buildTouchControls() {
    const scene = this.scene;
    const cam   = scene.cameras.main;
    const W     = cam.width;
    const H     = cam.height;
    const BTN   = 40;
    const GAP   = 6;

    // D-pad cluster (bottom-left)
    const padX = BTN + GAP;
    const padY = H - BTN - GAP;

    const dpadDefs = [
      { label: '←', dx: -(BTN + GAP), dy: 0,          dir: 'left' },
      { label: '→', dx:  (BTN + GAP), dy: 0,           dir: 'right' },
      { label: '↑', dx: 0,            dy: -(BTN + GAP), dir: 'up' },
      { label: '↓', dx: 0,            dy:  (BTN + GAP), dir: 'down' },
    ];

    this.touchKeys = {};

    dpadDefs.forEach(({ label, dx, dy, dir }) => {
      const btn = scene.add.rectangle(padX + dx, padY + dy, BTN, BTN, 0xffffff, 0.15)
        .setScrollFactor(0).setDepth(HUD_DEPTH).setInteractive();
      scene.add.text(padX + dx, padY + dy, label, {
        fontSize: '16px', color: '#ffffff', resolution: 2,
      }).setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0.5);

      this.touchKeys[dir] = { isDown: false };
      btn.on('pointerdown', () => { this.touchKeys[dir].isDown = true;  });
      btn.on('pointerup',   () => { this.touchKeys[dir].isDown = false; });
      btn.on('pointerout',  () => { this.touchKeys[dir].isDown = false; });
    });

    // Attack button (bottom-right)
    const atkX = W - BTN - GAP;
    const atkY = H - BTN - GAP;
    const atkBtn = scene.add.rectangle(atkX, atkY, BTN, BTN, 0xff4400, 0.5)
      .setScrollFactor(0).setDepth(HUD_DEPTH).setInteractive();
    scene.add.text(atkX, atkY, '⚔', {
      fontSize: '18px', color: '#ffffff', resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0.5);

    this.touchKeys.attack = { isDown: false };
    atkBtn.on('pointerdown', () => { this.touchKeys.attack.isDown = true;  });
    atkBtn.on('pointerup',   () => { this.touchKeys.attack.isDown = false; });
    atkBtn.on('pointerout',  () => { this.touchKeys.attack.isDown = false; });
  }

  update(gameData) {
    const { hp, maxHp, xp, coins } = gameData;
    const level = levelFromXp(xp);

    // Hearts
    this.hearts.forEach((h, i) => {
      h.full.setVisible(i < hp);
    });

    // XP fill
    const needed   = xpForLevel(level);
    let   prevXp   = 0;
    let   accum    = 0;
    for (let l = 1; l < level; l++) {
      prevXp += xpForLevel(l);
    }
    const progress = Math.min((xp - prevXp) / needed, 1);
    this.xpFill.setCrop(0, 0, Math.floor(128 * progress), 8);
    this.xpLabel.setText(`XP ${xp - prevXp}/${needed}`);
    this.levelLabel.setText(`LV ${level}`);

    // Coins
    this.coinLabel.setText(String(coins));
  }

  showFloatingText(x, y, text, color = '#fcd860') {
    const scene = this.scene;
    const cam   = scene.cameras.main;
    const sx    = x - cam.scrollX;
    const sy    = y - cam.scrollY;

    const label = scene.add.text(sx, sy, text, {
      fontSize: '12px',
      fontFamily: 'monospace',
      color,
      stroke: '#000000',
      strokeThickness: 3,
      resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 10).setOrigin(0.5);

    scene.tweens.add({
      targets: label,
      y: sy - 40,
      alpha: 0,
      duration: 1200,
      ease: 'Power2',
      onComplete: () => label.destroy(),
    });
  }
}
