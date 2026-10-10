// In-game HUD: hearts, level + XP bar, coin count, mini-map, touch controls.
// All elements are fixed to the screen (setScrollFactor(0)) and laid out in
// CSS pixels via uiSize(); view.js routes them to the HUD camera.

import { xpForLevel, levelFromXp, PORTAL_ZONES, BOSS_ZONES, MAP_COLS, MAP_ROWS, TILE_SIZE, TILE, buildBaseMap } from '../data/WorldData.js';
import { uiSize, pointerToUi } from '../engine/view.js';
import { textStyle, drawPanel, COLORS } from './theme.js';

const MAX_HEARTS = 5;
const HUD_DEPTH  = 100;
const MARGIN     = 10;
const PAD        = 10;

// Heart/coin textures are 16 px (8 design px × 2). 1.5× → 24 px, 3 px per
// design pixel, which stays even at every zoom view.js picks.
const ICON_SCALE = 1.5;
const ICON_SIZE  = 24;
const HEART_GAP  = 3;

const XP_BAR_W = 128;
const XP_BAR_H = 10;

// Mobile Exit chip (React) sits over the canvas top-right on narrow screens.
const NARROW_W       = 480;
const EXIT_CHIP_ROOM = 44;

const MINIMAP_TILE_COLORS = {
  [TILE.GRASS]:    '#4e9f3d',
  [TILE.FLOWER]:   '#5aa848',
  [TILE.DIRT]:     '#9b6b3d',
  [TILE.WATER]:    '#2f6fd6',
  [TILE.PATH]:     '#d9c38f',
  [TILE.TREE_TOP]: '#1f5e2c',
  [TILE.TREE_BOT]: '#1f5e2c',
  [TILE.WALL]:     '#8b8478',
  [TILE.SAND]:     '#e6d29a',
  [TILE.STONE]:    '#b3ada2',
  [TILE.BUSH]:     '#3f8f45',
  [TILE.ROCK]:     '#8e8a86',
};

export class HUD {
  constructor(scene) {
    this.scene   = scene;
    this.hearts  = [];
    this._surgeBanner = null;
    this._lastXpKey = null;
    this._buildHUD();
  }

  _add(obj, depth = HUD_DEPTH) {
    return obj.setScrollFactor(0).setDepth(depth);
  }

  _buildHUD() {
    const scene = this.scene;
    const { w: W } = uiSize(scene);
    this._narrow = W <= NARROW_W;

    // ── Top-left: hearts + level/XP ──────────────────────────────────
    const heartsW = MAX_HEARTS * ICON_SIZE + (MAX_HEARTS - 1) * HEART_GAP;
    const panelW  = PAD * 2 + heartsW + 28;          // + day/night icon
    const panelH  = PAD * 2 + ICON_SIZE + 8 + 20;
    this._leftPanel = { x: MARGIN, y: MARGIN, w: panelW, h: panelH };
    this._add(drawPanel(scene.add.graphics(), MARGIN, MARGIN, panelW, panelH), HUD_DEPTH - 1);

    for (let i = 0; i < MAX_HEARTS; i++) {
      const hx = MARGIN + PAD + i * (ICON_SIZE + HEART_GAP);
      const hy = MARGIN + PAD;
      const empty = this._add(scene.add.image(hx, hy, 'heart', 1).setOrigin(0).setScale(ICON_SCALE));
      const full  = this._add(scene.add.image(hx, hy, 'heart', 0).setOrigin(0).setScale(ICON_SCALE), HUD_DEPTH + 1);
      this.hearts.push({ empty, full, lastVisible: true });
    }

    // Day/night icon at the end of the heart row
    this._dayNightLabel = this._add(scene.add.text(
      MARGIN + panelW - PAD - 10, MARGIN + PAD + ICON_SIZE / 2, '☀',
      textStyle(16, COLORS.gold, { weight: 400, stroke: 3 }),
    ).setOrigin(0.5));

    // Level badge + XP bar row
    const rowY = MARGIN + PAD + ICON_SIZE + 8;
    this._levelBadgeBg = this._add(scene.add.graphics());
    this.levelLabel = this._add(scene.add.text(MARGIN + PAD + 19, rowY + 10, 'LV 1',
      textStyle(11, COLORS.ink, { weight: 800, stroke: 0 })).setOrigin(0.5), HUD_DEPTH + 2);
    this._levelBadge = { x: MARGIN + PAD, y: rowY, w: 38, h: 20 };

    const barX = MARGIN + PAD + 38 + 8;
    const barW = Math.min(XP_BAR_W, panelW - PAD - (barX - MARGIN));
    this._xpBar = { x: barX, y: rowY + 5, w: barW, h: XP_BAR_H };
    this._xpGfx = this._add(scene.add.graphics(), HUD_DEPTH + 1);
    this.xpLabel = this._add(scene.add.text(barX + barW / 2, rowY + 10, '',
      textStyle(9, COLORS.text, { weight: 800, stroke: 3 })).setOrigin(0.5), HUD_DEPTH + 3);

    // Combo counter (below the panel, hidden until first combo)
    this._comboLabel = this._add(scene.add.text(MARGIN + 4, MARGIN + panelH + 8, '',
      textStyle(14, COLORS.orange, { weight: 900, stroke: 4, align: 'left' })), HUD_DEPTH + 5).setVisible(false);
    this._comboFadeTimer = null;

    // ── Top-right: coins + mini-map ──────────────────────────────────
    const rightTop = MARGIN + (this._narrow ? EXIT_CHIP_ROOM : 0);
    this._buildCoins(W, rightTop);
    this._buildMinimap(W, rightTop + 40 + 8);

    // ── Touch action buttons (bottom) ────────────────────────────────
    if (scene.sys.game.device.input.touch) {
      this._buildTouchControls();
    }
  }

  _buildCoins(W, top) {
    const scene = this.scene;
    const pillH = 40;
    this._coinPill = { right: W - MARGIN, top, h: pillH };
    this._coinBg = this._add(scene.add.graphics(), HUD_DEPTH - 1);

    if (!scene.anims.exists('coin_spin')) {
      scene.anims.create({
        key: 'coin_spin',
        frames: scene.anims.generateFrameNumbers('coin', { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    this._coinIcon = this._add(scene.add.sprite(0, top + pillH / 2, 'coin').setOrigin(0, 0.5).setScale(ICON_SCALE));
    this._coinIcon.play('coin_spin');
    this.coinLabel = this._add(scene.add.text(0, top + pillH / 2, '0',
      textStyle(17, COLORS.gold, { weight: 800, stroke: 4, align: 'left' })).setOrigin(0, 0.5));
    this._layoutCoins('0');
  }

  _layoutCoins(text) {
    const { right, top, h } = this._coinPill;
    this.coinLabel.setText(text);
    const w = Math.max(84, PAD + ICON_SIZE + 8 + Math.ceil(this.coinLabel.width) + PAD + 2);
    const x = right - w;
    this._coinBg.clear();
    drawPanel(this._coinBg, x, top, w, h);
    this._coinIcon.setX(x + PAD);
    this.coinLabel.setX(x + PAD + ICON_SIZE + 8);
  }

  // Mini-map drawn from the real tile grid (rendered once into a texture),
  // with portal pins and live player/enemy dots on top.
  _buildMinimap(W, top) {
    const scene   = this.scene;
    const PX      = this._narrow ? 2 : 3;                // px per tile
    const MM_W    = MAP_COLS * PX;
    const MM_H    = MAP_ROWS * PX;
    const MM_X    = W - MARGIN - PAD / 2 - MM_W;
    const MM_Y    = top + PAD / 2;

    this._add(drawPanel(scene.add.graphics(), MM_X - PAD / 2, top, MM_W + PAD, MM_H + PAD), HUD_DEPTH - 1);

    const key = `minimap_${PX}`;
    const grid = scene.worldGrid ?? buildBaseMap();
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, MM_W, MM_H);
    const ctx = tex.context;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        ctx.fillStyle = MINIMAP_TILE_COLORS[grid[r]?.[c]] ?? MINIMAP_TILE_COLORS[TILE.GRASS];
        ctx.fillRect(c * PX, r * PX, PX, PX);
      }
    }
    // Building footprints
    (scene.buildingFootprints ?? []).forEach(({ x, y, w, h, color }) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x / TILE_SIZE * PX), Math.round(y / TILE_SIZE * PX),
        Math.max(PX, Math.round(w / TILE_SIZE * PX)), Math.max(PX, Math.round(h / TILE_SIZE * PX)));
    });
    tex.refresh();
    this._add(scene.add.image(MM_X, MM_Y, key).setOrigin(0));

    const scale = PX / TILE_SIZE;
    PORTAL_ZONES.forEach((zone) => {
      const px = MM_X + (zone.x + 0.5) * TILE_SIZE * scale;
      const py = MM_Y + (zone.y + 0.5) * TILE_SIZE * scale;
      const r  = zone.isRewardShop ? 4 : 3;
      this._add(scene.add.circle(px, py, r + 1, 0x000000, 0.6), HUD_DEPTH + 1);
      this._add(scene.add.circle(px, py, r, zone.color ?? 0xffffff, 1), HUD_DEPTH + 1);
    });

    // Boss respawn countdowns (shown while a boss is on cooldown)
    this._bossTimers = BOSS_ZONES.map((bz) => {
      const label = this._add(scene.add.text(
        MM_X + bz.x * TILE_SIZE * scale, MM_Y + bz.y * TILE_SIZE * scale - 3, '',
        textStyle(9, COLORS.red, { weight: 800, stroke: 3 }),
      ).setOrigin(0.5, 1), HUD_DEPTH + 3);
      return { bossType: bz.type, label };
    });

    this._mmGfx = this._add(scene.add.graphics(), HUD_DEPTH + 2);
    this._mmPos = { x: MM_X, y: MM_Y, scale };
  }

  _updateMinimap() {
    if (!this._mmGfx || !this._mmPos) return;
    const { x: mmX, y: mmY, scale } = this._mmPos;
    const gfx = this._mmGfx;
    gfx.clear();

    const enemies = this.scene.enemies;
    if (enemies) {
      enemies.getChildren().forEach((e) => {
        if (!e.active) return;
        const ex = mmX + e.x * scale;
        const ey = mmY + e.y * scale;
        if (e.isBoss) {
          gfx.fillStyle(0x000000, 0.7);
          gfx.fillCircle(ex, ey, 4);
          gfx.fillStyle(0xff3b3b, 1);
          gfx.fillCircle(ex, ey, 3);
        } else {
          gfx.fillStyle(0xff5a5a, 0.9);
          gfx.fillRect(ex - 1, ey - 1, 2, 2);
        }
      });
    }

    const player = this.scene.player;
    if (player) {
      const px = mmX + player.x * scale;
      const py = mmY + player.y * scale;
      gfx.fillStyle(0x000000, 0.8);
      gfx.fillCircle(px, py, 4);
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(px, py, 3);
    }

    const bossDefeats = this.scene.gameData?.bossDefeats ?? {};
    const RESPAWN_MS  = 24 * 60 * 60 * 1000;
    this._bossTimers?.forEach(({ bossType, label }) => {
      const defeatedAt = bossDefeats[bossType] ?? 0;
      const remaining  = defeatedAt ? RESPAWN_MS - (Date.now() - defeatedAt) : 0;
      if (remaining > 0) {
        label.setText(`${Math.ceil(remaining / (60 * 60 * 1000))}h`).setVisible(true);
      } else if (label.visible) {
        label.setVisible(false);
      }
    });
  }

  _drawXp(progress, level) {
    const { x, y, w, h } = this._xpBar;
    const g = this._xpGfx;
    g.clear();
    g.fillStyle(0x000000, 0.55);
    g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, (h + 2) / 2);
    g.fillStyle(0x1d2433, 1);
    g.fillRoundedRect(x, y, w, h, h / 2);
    const fw = Math.round(w * progress);
    if (fw > 0) {
      g.fillStyle(COLORS.greenHex, 1);
      g.fillRoundedRect(x, y, Math.max(fw, h), h, h / 2);
      g.fillStyle(0xffffff, 0.28);
      g.fillRoundedRect(x + 2, y + 1, Math.max(fw - 4, 2), 2, 1);
    }

    const b = this._levelBadge;
    const bg = this._levelBadgeBg;
    bg.clear();
    bg.fillStyle(COLORS.goldHex, 1);
    bg.fillRoundedRect(b.x, b.y, b.w, b.h, b.h / 2);
    bg.fillStyle(0xffffff, 0.35);
    bg.fillRoundedRect(b.x + 3, b.y + 2, b.w - 6, 3, 1.5);
    this.levelLabel.setText(level >= 100 ? `${level}` : `LV ${level}`);
  }

  _buildTouchControls() {
    const scene = this.scene;
    const { w: W, h: H } = uiSize(scene);

    this.touchKeys = {
      left:   { isDown: false },
      right:  { isDown: false },
      up:     { isDown: false },
      down:   { isDown: false },
      attack: { isDown: false },
    };

    // ── Virtual joystick (bottom-left) ───────────────────────────────
    const JOY_R  = 46;
    const JOY_X  = JOY_R + 22;
    const JOY_Y  = H - JOY_R - 26;

    this._add(scene.add.circle(JOY_X, JOY_Y, JOY_R, 0x0f1420, 0.45));
    const joyRing = this._add(scene.add.graphics(), HUD_DEPTH + 1);
    joyRing.lineStyle(2, 0xffffff, 0.35);
    joyRing.strokeCircle(JOY_X, JOY_Y, JOY_R);
    const joyThumb = this._add(scene.add.circle(JOY_X, JOY_Y, 20, 0xffffff, 0.55), HUD_DEPTH + 2);

    let activeId = null;

    const updateJoy = (ptr) => {
      const p    = pointerToUi(scene, ptr);
      const dx   = p.x - JOY_X;
      const dy   = p.y - JOY_Y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const max  = JOY_R * 0.72;
      const angle = Math.atan2(dy, dx);
      const clamped = Math.min(dist, max);
      joyThumb.setPosition(JOY_X + Math.cos(angle) * clamped, JOY_Y + Math.sin(angle) * clamped);
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
      const p = pointerToUi(scene, ptr);
      if (p.x < W / 2 && p.y > H * 0.55) {
        activeId = ptr.id;
        updateJoy(ptr);
      }
    });
    scene.input.on('pointermove', (ptr) => { if (ptr.id === activeId) updateJoy(ptr); });
    scene.input.on('pointerup',  (ptr) => { if (ptr.id === activeId) releaseJoy(); });
    scene.input.on('pointerout', (ptr) => { if (ptr.id === activeId) releaseJoy(); });

    // ── Attack button (bottom-right) ─────────────────────────────────
    const ATK_R = 34;
    const ATK_X = W - ATK_R - 24;
    const ATK_Y = H - ATK_R - 30;

    const atkBtn = this._add(scene.add.circle(ATK_X, ATK_Y, ATK_R, 0xff6a2b, 0.8)).setInteractive();
    atkBtn.setStrokeStyle(3, 0xffffff, 0.5);
    this._add(scene.add.text(ATK_X, ATK_Y, '⚔', textStyle(26, '#ffffff', { weight: 400, stroke: 0 })).setOrigin(0.5), HUD_DEPTH + 1);

    atkBtn.on('pointerdown', () => {
      this.touchKeys.attack.isDown = true;
      const ripple = this._add(scene.add.circle(ATK_X, ATK_Y, ATK_R, 0xffa24c, 0.4), HUD_DEPTH - 1);
      scene.tweens.add({
        targets: ripple, scaleX: 2.2, scaleY: 2.2, alpha: 0,
        duration: 360, ease: 'Power2',
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

    const color = multiplier >= 3 ? COLORS.red : COLORS.orange;
    this._comboLabel.setText(`${multiplier}× combo!`).setColor(color).setVisible(true).setAlpha(1).setScale(1.25);
    this.scene.tweens.add({ targets: this._comboLabel, scale: 1, duration: 160, ease: 'Back.easeOut' });

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

  // Called each frame with the current night overlay alpha (0 = day, 0.55 = full night).
  updateNightCycle(nightAlpha) {
    if (!this._dayNightLabel) return;
    const ratio = nightAlpha / 0.55;
    const phase = ratio > 0.6 ? 'night' : ratio > 0.25 ? 'dusk' : 'day';
    if (phase === this._dayPhase) return;
    this._dayPhase = phase;
    if (phase === 'night')     this._dayNightLabel.setText('☾').setColor(COLORS.sky);
    else if (phase === 'dusk') this._dayNightLabel.setText('☀').setColor(COLORS.orange);
    else                       this._dayNightLabel.setText('☀').setColor(COLORS.gold);
  }

  update(gameData) {
    const { hp, xp, coins } = gameData;
    const level = levelFromXp(xp);

    this.hearts.forEach((h, i) => {
      const visible = i < hp;
      if (visible !== h.lastVisible) {
        h.full.setVisible(visible);
        h.lastVisible = visible;
        if (!visible) {
          // Little pop when a heart is lost
          this.scene.tweens.add({ targets: h.empty, scale: ICON_SCALE * 1.3, yoyo: true, duration: 110 });
        }
      }
    });

    // XP — only redraw when something changed
    const key = `${xp}|${level}`;
    if (key !== this._lastXpKey) {
      this._lastXpKey = key;
      const needed = xpForLevel(level);
      let prevXp = 0;
      for (let l = 1; l < level; l++) prevXp += xpForLevel(l);
      const into = xp - prevXp;
      this._drawXp(Math.min(into / needed, 1), level);
      this.xpLabel.setText(`${into} / ${needed} XP`);
    }

    const coinText = String(coins);
    if (coinText !== this.coinLabel.text) this._layoutCoins(coinText);

    this._updateMinimap();
  }

  // ── Chore Surge banner ────────────────────────────────────────────────────────
  // Slides in below the HUD, holds for most of durationMs, then slides out.
  showSurgeBanner(durationMs = 90_000) {
    const scene = this.scene;
    const { w } = uiSize(scene);
    const bw = Math.min(w - 2 * MARGIN, 300);
    const bh = 40;
    const targetY = this._leftPanel.y + this._leftPanel.h + (this._narrow ? 40 : 18) + bh / 2;

    const bg = this._add(scene.add.graphics(), 160);
    bg.fillStyle(0x2a1a00, 0.94);
    bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    bg.lineStyle(2, COLORS.goldHex, 1);
    bg.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    bg.setPosition(w / 2, -40);

    const txt = this._add(scene.add.text(w / 2, -40, '⚡ Chore Surge!  2× XP', textStyle(15, COLORS.gold, { weight: 900, stroke: 0 }))
      .setOrigin(0.5), 161);

    const banner = { bg, txt, introTween: null, holdTimer: null, outroTween: null };
    this._surgeBanner = banner;

    banner.introTween = scene.tweens.add({
      targets: [bg, txt], y: targetY,
      duration: 340, ease: 'Back.easeOut',
      onComplete: () => {
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

  // Floating text lives in world space so it tracks the spot it pops from.
  showFloatingText(x, y, text, color = COLORS.gold) {
    const scene = this.scene;
    const label = scene.add.text(x, y, text, textStyle(13, color, { weight: 900, stroke: 4 }))
      .setDepth(60).setOrigin(0.5);

    scene.tweens.add({
      targets: label,
      y: y - 36,
      alpha: 0,
      duration: 1100,
      ease: 'Power2',
      onComplete: () => label.destroy(),
    });
  }
}
