// In-game HUD: hearts, XP bar, level, coin count, mini-map, touch controls.
// All elements are fixed to the camera (setScrollFactor(0)).

import Phaser from 'phaser';
import { xpForLevel, levelFromXp, PORTAL_ZONES, BOSS_ZONES, MAP_COLS, TILE_SIZE } from '../data/WorldData.js';

const MAX_HEARTS   = 5;
const HUD_DEPTH    = 100;
const PADDING      = 8;
const HEART_SCALE  = 3;            // 8px source × 3 = 24px display
const HEART_SIZE   = 8 * HEART_SCALE;
const HEART_GAP    = 3;

const WORLD_PX = MAP_COLS * TILE_SIZE; // 1280 px

export class HUD {
  constructor(scene) {
    this.scene   = scene;
    this.hearts  = [];
    this.xpMask  = null;
    this._surgeBanner = null;
    this._buildHUD();
  }

  _buildHUD() {
    const scene = this.scene;
    const cam   = scene.cameras.main;
    const W     = cam.width;

    const xpY  = PADDING + HEART_SIZE + 6;
    const BAR_W = 128;
    const HUD_BG_H = xpY + 12 + 6;

    // ── Dark background strip for top-left HUD ───────────────────────
    // Width covers hearts row OR xp bar + level badge, whichever is wider.
    // BAR_W * 1.25 = 160px bar + 50px for level badge text = 210px content.
    const HUD_BG_CONTENT = Math.max(
      MAX_HEARTS * (HEART_SIZE + HEART_GAP),   // hearts: 135px
      BAR_W * 1.25 + 50,                        // xp bar + level badge: 210px
    );
    const bgLeft = scene.add.graphics();
    bgLeft.fillStyle(0x0d0d14, 0.62);
    bgLeft.fillRoundedRect(4, 4, PADDING + HUD_BG_CONTENT + 6, HUD_BG_H, 8);
    bgLeft.lineStyle(1, 0xffffff, 0.10);
    bgLeft.strokeRoundedRect(4, 4, PADDING + HUD_BG_CONTENT + 6, HUD_BG_H, 8);
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
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 3); // above xpFill crop edge

    // ── Coin counter (top-right) ──────────────────────────────────────
    const coinX = W - PADDING - 48;
    const bgRight = scene.add.graphics();
    bgRight.fillStyle(0x0d0d14, 0.62);
    bgRight.fillRoundedRect(coinX - 6, 4, 62, 28, 8);
    bgRight.lineStyle(1, 0xffffff, 0.10);
    bgRight.strokeRoundedRect(coinX - 6, 4, 62, 28, 8);
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

    // ── Mini-map (top-right, below coin counter) ──────────────────────
    this._buildMinimap(W);

    // ── Combo counter (below XP bar, hidden until first combo) ──────
    this._comboLabel = scene.add.text(PADDING, xpY + 20, '', {
      fontSize: '10px', fontFamily: 'monospace',
      color: '#ff8800', stroke: '#000000', strokeThickness: 3, resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 5).setVisible(false);
    this._comboFadeTimer = null;

    // ── Day/night clock icon (top-center) ───────────────────────────
    // Unicode sun ☀ → moon ☾ tint shifts as the overlay darkens.
    this._dayNightLabel = scene.add.text(W / 2, 6, '☀', {
      fontSize: '12px', fontFamily: 'monospace', color: '#fcd860',
      stroke: '#000000', strokeThickness: 3, resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0.5, 0);

    // ── Touch action buttons (bottom) ────────────────────────────────
    if (scene.sys.game.device.input.touch) {
      this._buildTouchControls();
    }
  }

  _buildMinimap(W) {
    const scene   = this.scene;
    const MM_SIZE = 80;
    const MM_X    = W - MM_SIZE - PADDING;
    const MM_Y    = 44; // below coin counter

    // Background
    const mmBg = scene.add.graphics();
    mmBg.fillStyle(0x0d0d14, 0.70);
    mmBg.fillRoundedRect(MM_X - 4, MM_Y - 4, MM_SIZE + 8, MM_SIZE + 8, 6);
    mmBg.lineStyle(1, 0xffffff, 0.12);
    mmBg.strokeRoundedRect(MM_X - 4, MM_Y - 4, MM_SIZE + 8, MM_SIZE + 8, 6);
    mmBg.setScrollFactor(0).setDepth(HUD_DEPTH - 1);

    // Dark green fill
    const mmFill = scene.add.graphics();
    mmFill.fillStyle(0x0a1a0a, 1);
    mmFill.fillRect(MM_X, MM_Y, MM_SIZE, MM_SIZE);
    mmFill.setScrollFactor(0).setDepth(HUD_DEPTH);

    // "MAP" label
    scene.add.text(MM_X + MM_SIZE / 2, MM_Y - 3, 'MAP', {
      fontSize: '7px', fontFamily: 'monospace', color: '#556655',
      stroke: '#000', strokeThickness: 2, resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH).setOrigin(0.5, 1);

    // Water border trace — gives the map geographic context
    const mmBorder = scene.add.graphics();
    mmBorder.lineStyle(1, 0x4880e8, 0.45);
    mmBorder.strokeRect(MM_X, MM_Y, MM_SIZE, MM_SIZE);
    mmBorder.setScrollFactor(0).setDepth(HUD_DEPTH + 1);

    // Path tile layer — main cross paths run through tile 19–20 (midRow/midCol of 40×40 map).
    // Each tile = 2px on the 80px mini-map (80 / 40 = 2).
    // The path is 2 tiles wide, so draw a 4px-wide cross centred at tile 19.5.
    const mmPath = scene.add.graphics();
    mmPath.fillStyle(0xbcbcbc, 0.30); // light grey, semi-transparent
    const pathTile  = 19;             // first of the two mid-column/row tiles
    const pathPx    = pathTile * 2;   // pixel position on the 80px map
    // Vertical path (columns 19–20 → x 38–41)
    mmPath.fillRect(MM_X + pathPx, MM_Y, 4, MM_SIZE);
    // Horizontal path (rows 19–20 → y 38–41)
    mmPath.fillRect(MM_X, MM_Y + pathPx, MM_SIZE, 4);
    mmPath.setScrollFactor(0).setDepth(HUD_DEPTH + 1);

    // Portal markers (static) — castle marker larger and brighter
    const scale = MM_SIZE / WORLD_PX;
    PORTAL_ZONES.forEach((zone) => {
      const px = MM_X + zone.x * TILE_SIZE * scale;
      const py = MM_Y + zone.y * TILE_SIZE * scale;
      const colorHex = zone.color ?? 0xffffff;
      const sz = zone.isRewardShop ? 6 : 4;
      scene.add.rectangle(px, py, sz, sz, colorHex, 0.9)
        .setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0.5);
    });

    // Boss respawn timer labels — shown when boss is defeated (re-evaluated in update)
    this._bossTimers = BOSS_ZONES.map((bz) => {
      const px = MM_X + bz.x * TILE_SIZE * scale;
      const py = MM_Y + bz.y * TILE_SIZE * scale;
      const label = scene.add.text(px, py - 4, '', {
        fontSize: '5px', fontFamily: 'monospace', color: '#ff8888',
        stroke: '#000', strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(HUD_DEPTH + 3).setOrigin(0.5, 1);
      return { bossType: bz.type, label };
    });

    // Dynamic graphics (player + enemies) — redrawn each frame
    this._mmGfx = scene.add.graphics()
      .setScrollFactor(0).setDepth(HUD_DEPTH + 2);

    this._mmPos = { x: MM_X, y: MM_Y, size: MM_SIZE, scale };
  }

  _updateMinimap() {
    if (!this._mmGfx || !this._mmPos) return;
    const { x: mmX, y: mmY, scale } = this._mmPos;
    const gfx = this._mmGfx;
    gfx.clear();

    // Enemy dots (red)
    const enemies = this.scene.enemies;
    if (enemies) {
      gfx.fillStyle(0xff3333, 0.85);
      enemies.getChildren().forEach((e) => {
        if (!e.active) return;
        const ex = mmX + e.x * scale;
        const ey = mmY + e.y * scale;
        gfx.fillRect(ex - 1, ey - 1, e.isBoss ? 4 : 2, e.isBoss ? 4 : 2);
      });
    }

    // Player dot (white, slightly larger)
    const player = this.scene.player;
    if (player) {
      gfx.fillStyle(0xffffff, 1);
      gfx.fillRect(mmX + player.x * scale - 2, mmY + player.y * scale - 2, 4, 4);
    }

    // Boss respawn countdown labels
    const bossDefeats = this.scene.gameData?.bossDefeats ?? {};
    const RESPAWN_MS  = 24 * 60 * 60 * 1000;
    if (this._bossTimers) {
      this._bossTimers.forEach(({ bossType, label }) => {
        const defeatedAt = bossDefeats[bossType] ?? 0;
        const remaining  = defeatedAt ? RESPAWN_MS - (Date.now() - defeatedAt) : 0;
        if (remaining > 0) {
          const hrs = Math.ceil(remaining / (60 * 60 * 1000));
          label.setText(`${hrs}h`);
          label.setVisible(true);
        } else {
          label.setVisible(false);
        }
      });
    }
  }

  _buildTouchControls() {
    const scene = this.scene;
    const W     = scene.cameras.main.width;
    const H     = scene.cameras.main.height;

    this.touchKeys = {
      left:   { isDown: false },
      right:  { isDown: false },
      up:     { isDown: false },
      down:   { isDown: false },
      attack: { isDown: false },
    };

    // ── Virtual joystick (bottom-left) ───────────────────────────────
    const JOY_R  = 40;
    const JOY_X  = JOY_R + 16;
    const JOY_Y  = H - JOY_R - 20;

    // Base ring
    scene.add.circle(JOY_X, JOY_Y, JOY_R, 0xffffff, 0.10)
      .setScrollFactor(0).setDepth(HUD_DEPTH);
    const joyRing = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    joyRing.lineStyle(1, 0xffffff, 0.30);
    joyRing.strokeCircle(JOY_X, JOY_Y, JOY_R);

    // Thumb
    const joyThumb = scene.add.circle(JOY_X, JOY_Y, 18, 0xffffff, 0.40)
      .setScrollFactor(0).setDepth(HUD_DEPTH + 2);

    let activeId = null;

    const updateJoy = (ptr) => {
      const dx   = ptr.x - JOY_X;
      const dy   = ptr.y - JOY_Y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const max  = JOY_R * 0.72;
      const angle = Math.atan2(dy, dx);
      const clamped = Math.min(dist, max);
      joyThumb.setPosition(
        JOY_X + Math.cos(angle) * clamped,
        JOY_Y + Math.sin(angle) * clamped,
      );
      const dead = JOY_R * 0.28;
      this.touchKeys.left.isDown  = dx < -dead;
      this.touchKeys.right.isDown = dx >  dead;
      this.touchKeys.up.isDown    = dy < -dead;
      this.touchKeys.down.isDown  = dy >  dead;
    };

    const releaseJoy = () => {
      activeId = null;
      joyThumb.setPosition(JOY_X, JOY_Y);
      this.touchKeys.left.isDown  = false;
      this.touchKeys.right.isDown = false;
      this.touchKeys.up.isDown    = false;
      this.touchKeys.down.isDown  = false;
    };

    scene.input.on('pointerdown', (ptr) => {
      if (activeId !== null) return;
      if (ptr.x < W / 2 && ptr.y > H * 0.55) {
        activeId = ptr.id;
        updateJoy(ptr);
      }
    });
    scene.input.on('pointermove', (ptr) => {
      if (ptr.id === activeId) updateJoy(ptr);
    });
    scene.input.on('pointerup',  (ptr) => { if (ptr.id === activeId) releaseJoy(); });
    scene.input.on('pointerout', (ptr) => { if (ptr.id === activeId) releaseJoy(); });

    // ── Attack button (bottom-right) — 56 px circle + ripple ─────────
    const ATK_R = 28;
    const ATK_X = W - ATK_R - 20;
    const ATK_Y = H - ATK_R - 20;

    const atkBtn = scene.add.circle(ATK_X, ATK_Y, ATK_R, 0xff4400, 0.55)
      .setScrollFactor(0).setDepth(HUD_DEPTH).setInteractive();
    scene.add.text(ATK_X, ATK_Y, '⚔', {
      fontSize: '22px', color: '#ffffff', resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 1).setOrigin(0.5);

    atkBtn.on('pointerdown', () => {
      this.touchKeys.attack.isDown = true;
      // Ripple effect
      const ripple = scene.add.circle(ATK_X, ATK_Y, ATK_R, 0xff8800, 0.40)
        .setScrollFactor(0).setDepth(HUD_DEPTH - 1);
      scene.tweens.add({
        targets: ripple, scaleX: 2.6, scaleY: 2.6, alpha: 0,
        duration: 380, ease: 'Power2',
        onComplete: () => ripple.destroy(),
      });
    });
    atkBtn.on('pointerup',  () => { this.touchKeys.attack.isDown = false; });
    atkBtn.on('pointerout', () => { this.touchKeys.attack.isDown = false; });
  }

  showCombo(multiplier) {
    if (!this._comboLabel) return;
    this.scene.tweens.killTweensOf(this._comboLabel);
    if (this._comboFadeTimer) {
      this._comboFadeTimer.remove(false);
      this._comboFadeTimer = null;
    }

    const color = multiplier >= 3 ? '#ff4444' : '#ff8800';
    const stars = multiplier >= 3 ? '★★★' : '★★';
    this._comboLabel.setText(`${multiplier}× COMBO! ${stars}`)
      .setColor(color).setVisible(true).setAlpha(1);

    // Cancel any running fade and restart 1.5 s countdown
    this._comboFadeTimer = this.scene.time.delayedCall(1500, () => {
      this.scene.tweens.add({
        targets: this._comboLabel, alpha: 0, duration: 400,
        onComplete: () => {
          this._comboLabel?.setVisible(false);
          this._comboFadeTimer = null;
        },
      });
    });
  }

  // Called each frame with the current night overlay alpha (0 = full day, 0.55 = full night).
  // Three zones: day → dusk → night, avoiding an abrupt binary snap.
  updateNightCycle(nightAlpha) {
    if (!this._dayNightLabel) return;
    const ratio = nightAlpha / 0.55; // normalise to 0–1
    if (ratio > 0.6) {
      this._dayNightLabel.setText('☾').setColor('#a4e4fc'); // night — pale blue
    } else if (ratio > 0.25) {
      this._dayNightLabel.setText('☀').setColor('#f08828'); // dusk — orange
    } else {
      this._dayNightLabel.setText('☀').setColor('#fcd860'); // day — yellow
    }
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
    for (let l = 1; l < level; l++) {
      prevXp += xpForLevel(l);
    }
    const progress = Math.min((xp - prevXp) / needed, 1);
    this.xpFill.setCrop(0, 0, Math.floor(128 * progress), 8);
    this.xpLabel.setText(`XP ${xp - prevXp}/${needed}`);
    this.levelLabel.setText(`LV ${level}`);

    // Coins
    this.coinLabel.setText(String(coins));

    // Mini-map
    this._updateMinimap();
  }

  // ── Chore Surge banner ────────────────────────────────────────────────────────
  // Slides in from the top, holds for most of durationMs, then slides out.
  showSurgeBanner(durationMs = 90_000) {
    const scene = this.scene;
    const cam   = scene.cameras.main;
    const w     = cam.width;

    const bg = scene.add.rectangle(w / 2, -30, Math.min(w * 0.82, 340), 28, 0x1a1000, 0.92)
      .setScrollFactor(0).setDepth(160)
      .setStrokeStyle(2, 0xf8b800);

    const txt = scene.add.text(w / 2, -30, '⚡  CHORE SURGE!  2× XP', {
      fontSize: '12px', fontFamily: 'monospace', color: '#fcd860',
      stroke: '#000', strokeThickness: 4, resolution: 2,
    }).setScrollFactor(0).setDepth(161).setOrigin(0.5);

    const banner = { bg, txt, introTween: null, holdTimer: null, outroTween: null };
    this._surgeBanner = banner;

    const targetY = 50; // just below the hearts/XP HUD strip

    banner.introTween = scene.tweens.add({
      targets: [bg, txt], y: targetY,
      duration: 340, ease: 'Back.easeOut',
      onComplete: () => {
        // Slide out 1 s before the surge ends
        const holdMs = Math.max(200, durationMs - 1000);
        banner.holdTimer = scene.time.delayedCall(holdMs, () => {
          banner.holdTimer = null;
          banner.outroTween = scene.tweens.add({
            targets: [bg, txt], y: -50, alpha: 0,
            duration: 400, ease: 'Power2',
            onComplete: () => {
              if (this._surgeBanner === banner) this._surgeBanner = null;
              bg.destroy();
              txt.destroy();
            },
          });
        });
      },
    });
  }

  setPaused(paused) {
    if (!this._surgeBanner) return;
    const { introTween, holdTimer, outroTween } = this._surgeBanner;
    if (holdTimer) holdTimer.paused = paused;
    try {
      if (paused) {
        introTween?.pause?.();
        outroTween?.pause?.();
      } else {
        introTween?.resume?.();
        outroTween?.resume?.();
      }
    } catch (_) {}
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
