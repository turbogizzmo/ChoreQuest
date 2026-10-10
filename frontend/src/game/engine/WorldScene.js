// WorldScene: the main overworld. Player walks, fights, and enters portals.

import Phaser from 'phaser';
import { buildWorldTilemap }     from '../maps/WorldMap.js';
import { createPlayer, updatePlayer, playAttackAnim, PLAYER_SPEED } from '../entities/Player.js';
import { createEnemyAnimations, spawnEnemy, updateEnemy } from '../entities/Enemy.js';
import { PortalManager }         from '../chore-portals/PortalManager.js';
import { BattleSystem }          from '../systems/BattleSystem.js';
import { HUD }                   from '../ui/HUD.js';
import { writeSave }             from '../systems/SaveSystem.js';
import { SoundSystem }           from '../systems/SoundSystem.js';
import { pickRespawnPoint }      from '../systems/RespawnSystem.js';
import { PORTAL_ZONES, ENEMY_ZONES, BOSS_ZONES, BOSS_STATS, BUILDINGS, TILE, TILE_SIZE, MAP_COLS, levelFromXp, tileHash, SURGE_INTERVAL, SURGE_DURATION, SURGE_XP_MULT } from '../data/WorldData.js';
import { paintGround } from '../sprites/WorldArt.js';
import { ChestSystem } from '../systems/ChestSystem.js';
import { NPC }         from '../entities/NPC.js';
import { api } from '../../api/client.js';
import { setupCameras, uiSize } from './view.js';
import { textStyle, drawPanel, COLORS } from '../ui/theme.js';
import { DEPTH, ySort } from './depth.js';

const HUD_DEPTH = 100;

const SAVE_INTERVAL = 15000; // ms
const RESPAWN_INVULNERABILITY_MS = 3000;
const RESPAWN_BLINK_ALPHA = 0.65;
const RESPAWN_BLINK_INTERVAL_MS = 120;

// Road tile just south of the castle gate
const SAFE_SPAWN = { x: 20 * TILE_SIZE + TILE_SIZE / 2, y: 20 * TILE_SIZE + TILE_SIZE / 2 };

export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data) {
    this.userId    = data.userId;
    this.userName  = data.userName;
    this.isKid     = data.isKid ?? false;  // gates backend progress-sync; parents get local-only saves
    this.gameData  = { ...data.gameData };
    // A save written mid-faint (tab closed during the respawn animation) has
    // hp 0 on a living hero — start them with the respawn hearts instead.
    if (!(this.gameData.hp > 0)) this.gameData.hp = Math.min(3, this.gameData.maxHp ?? 5);
    this.tileMap   = data.tileMap;
    this.onExit    = data.onExit    ?? (() => {});
    this.onComplete = data.onComplete ?? (() => {});

    this._portalCooldown = 0;
    this._portalLockId   = null;
    this._saveTick       = 0;
    this._paused         = false;
    this._lastLevel      = levelFromXp(data.gameData?.xp ?? 0);

    // Phase 5-A: Chore Surge & boss proximity
    this._surgeActive    = false;
    this._surgeTimer     = null;
    this._surgeEndTimer  = null;
    this._nearBoss       = false;
    this._bossProxTick   = 0;   // frame counter for proximity check throttle
    this._nightAlpha     = 0;   // updated each frame; seed to 0 (day) until first update()
    this._respawnInvulnerableUntil = data.respawnInvulnerableUntil ?? 0;
    this._nextRespawnBlinkAt = 0;
    this._respawnBlinkOn = false;
  }

  create() {
    // Device-resolution canvas: world camera + separate HUD camera (view.js)
    setupCameras(this);

    // Phaser does NOT clear scene.events listeners on restart — without this,
    // every death/respawn stacks a second set of gameplay listeners (double XP,
    // double sounds) and double-queues scene.restart, which orphans a looping
    // SoundSystem (music playing over itself).
    this._gameplayListeners = [];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());

    // ── Tilemap ────────────────────────────────────────────────────────
    const { map, layer } = buildWorldTilemap(this);
    this.worldLayer = layer;

    // ── Painted ground, scenery and buildings ──────────────────────────
    this._buildScenery();
    this._shadows = [];

    // ── Player ─────────────────────────────────────────────────────────
    this.player = createPlayer(
      this,
      this.gameData.playerX,
      this.gameData.playerY,
    );
    // Old saves may place the hero where a building or tree now stands
    if (this._isBlockedAt(this.player.x, this.player.y)) {
      this.player.setPosition(SAFE_SPAWN.x, SAFE_SPAWN.y);
    }
    this._addShadow(this.player, 0.85, 14);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // Collision: player <-> world tiles
    this.physics.add.collider(this.player, layer);

    // ── Enemies ────────────────────────────────────────────────────────
    createEnemyAnimations(this);
    this.enemies = this.physics.add.group();
    ENEMY_ZONES.forEach((zone) => {
      for (let i = 0; i < zone.count; i++) {
        let jx = zone.x * TILE_SIZE + (Math.random() - 0.5) * TILE_SIZE * 2;
        let jy = zone.y * TILE_SIZE + (Math.random() - 0.5) * TILE_SIZE * 2;
        if (this._isBlockedAt(jx, jy)) { jx = zone.x * TILE_SIZE; jy = zone.y * TILE_SIZE; }
        const enemy = spawnEnemy(this, zone.type, jx, jy);
        this._addShadow(enemy, 0.6, 12);
        this.enemies.add(enemy);
        this.physics.add.collider(enemy, layer);
      }
    });

    // ── Boss enemies (one per portal zone, skip if defeated < 24 h ago) ──
    const bossDefeats = this.gameData.bossDefeats ?? {};
    const RESPAWN_MS  = 24 * 60 * 60 * 1000;
    BOSS_ZONES.forEach((bz) => {
      const lastDefeated = bossDefeats[bz.type] ?? 0;
      if (Date.now() - lastDefeated < RESPAWN_MS) return; // still on cooldown
      const bx = bz.x * TILE_SIZE;
      const by = bz.y * TILE_SIZE;
      const boss = spawnEnemy(this, bz.type, bx, by, true);
      this._addShadow(boss, 1.5, 28);
      this.enemies.add(boss);
      this.physics.add.collider(boss, layer);
    });

    // Enemy<->player contact
    this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
      this.battle.enemyContactDamage(player, enemy);
    });

    // ── Portals ────────────────────────────────────────────────────────
    this.portalMgr = new PortalManager(this);
    this.portalMgr.addOverlap(this.player);
    Object.entries(this.gameData.portalRestoreLevels ?? {}).forEach(([id, lvl]) => {
      this.portalMgr.setRestoreLevel(id, lvl);
    });

    // ── Sound system ────────────────────────────────────────────────────
    this.sfx = new SoundSystem(this);
    this.sfx.startBGM();

    // ── HUD — must be created before event listeners that call this.hud ─
    this.hud = new HUD(this);

    // ── Battle system ──────────────────────────────────────────────────
    this.battle = new BattleSystem(this);
    this._onGameplay('enemyHurt', ({ enemy, damage }) => {
      // Show damage number over every hit — makes attacks feel responsive
      this.hud.showFloatingText(enemy.x, enemy.y - 16, `-${damage}`, '#ff4444');
    });

    this._onGameplay('enemyDefeated', ({ enemy, xpDrop, coinDrop }) => {
      // Phase 5-A: apply 2× XP multiplier during a Chore Surge
      const surgeXp = this._surgeActive ? Math.round(xpDrop * SURGE_XP_MULT) : xpDrop;

      this.gameData.xp    += surgeXp;
      this.gameData.coins += coinDrop;

      // Record boss defeat for 24-hour respawn timer
      if (enemy.isBoss) {
        if (!this.gameData.bossDefeats) this.gameData.bossDefeats = {};
        this.gameData.bossDefeats[enemy.enemyType] = Date.now();
      }

      const xpLabel = this._surgeActive ? `+${surgeXp} XP ⚡` : `+${surgeXp} XP`;
      this.hud.showFloatingText(enemy.x, enemy.y, xpLabel, this._surgeActive ? '#fcd860' : '#58d854');
      this.hud.showFloatingText(enemy.x, enemy.y + 14, `+${coinDrop}¢`, '#fcd860');
      this.sfx.playEnemyDefeat();
      if (coinDrop > 0) this.time.delayedCall(280, () => this.sfx.playCoinPickup());

      // Loot drop: animated coin sprites that fly toward the player
      if (coinDrop > 0) this._spawnCoinDrop(enemy.x, enemy.y, coinDrop);

      // Phase 5-A: 20% chance to drop a chest
      this.chestSystem?.trySpawn(enemy.x, enemy.y);
    });

    this._onGameplay('comboHit', ({ multiplier }) => {
      this.hud.showCombo(multiplier);    // persistent HUD counter
      this.hud.showFloatingText(         // floating pop for immediate impact
        this.player.x, this.player.y - 48,
        `${multiplier}× COMBO!`,
        multiplier >= 3 ? '#ff4444' : '#ff8800',
      );
      this.sfx.playCombo(multiplier);
    });
    this._onGameplay('playerHurt', ({ damage }) => {
      this.gameData.hp = Math.max(0, this.gameData.hp - damage);
      this.sfx.playPlayerHurt();
      if (this.gameData.hp <= 0) this._handlePlayerDeath();
    });

    // ── Portal entry ───────────────────────────────────────────────────
    this._onGameplay('portalEnter', (zoneData) => {
      if (!zoneData?.id) return;
      if (this._portalLockId === zoneData.id) return;
      const now = Date.now();
      if (now - this._portalCooldown < 2000) return;
      this._portalCooldown = now;
      this._portalLockId = zoneData.id;
      this.sfx.playPortalEnter();
      this.onComplete({ type: 'portalEnter', zone: zoneData, gameData: this.gameData });
    });

    // ── Day/night cycle overlay ────────────────────────────────────────
    // Cycles from clear (day) to dark blue (night) over 10 real minutes.
    // Above the whole world (sprites included); labels/HUD stay readable on top.
    const worldPx = MAP_COLS * TILE_SIZE;
    // Fill must be opaque: the cycle drives the object's alpha, and a 0 fill
    // alpha multiplied by it kept the night invisible.
    this._nightOverlay = this.add.rectangle(
      worldPx / 2, worldPx / 2, worldPx, worldPx, 0x0b1640, 1,
    ).setDepth(DEPTH.NIGHT).setAlpha(0);
    this._cycleStart = this.time.now;

    // ── Keyboard ──────────────────────────────────────────────────────
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd    = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.escKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // ── Pause overlay (ESC) ───────────────────────────────────────────
    this.escKey.on('down', () => this._togglePause());

    // ── World name banner ─────────────────────────────────────────────
    const { w: uiW, h: uiH } = uiSize(this);
    const banner = this.add.text(uiW / 2, uiH * 0.24, 'Home Realm', textStyle(26, COLORS.gold, { weight: 900, stroke: 6 }))
      .setScrollFactor(0).setDepth(50).setOrigin(0.5);
    const bannerSub = this.add.text(uiW / 2, uiH * 0.24 + 28, 'The Broken Village', textStyle(14, COLORS.text, { stroke: 4 }))
      .setScrollFactor(0).setDepth(50).setOrigin(0.5);
    this.tweens.add({ targets: [banner, bannerSub], alpha: 0, delay: 2600, duration: 900,
      onComplete: () => { banner.destroy(); bannerSub.destroy(); } });

    // ── Phase 5-A: Chest loot system ──────────────────────────────────
    this.chestSystem = new ChestSystem(this);
    this._onGameplay('chestCollect', ({ coins, xp }) => {
      this.gameData.coins += coins;
      this.gameData.xp    += xp;
      this.sfx.playCoinPickup();
      this.hud.showFloatingText(
        this.player?.x ?? 320, this.player?.y ?? 240,
        `+${coins}¢  +${xp} XP`, '#fcd860',
      );
    });

    // ── Phase 5-A: NPC shopkeeper, on the plaza just east of the castle
    this.npc = new NPC(this, 23, 17);

    // ── Phase 5-A: Chore Surge world event ────────────────────────────
    // First surge fires SURGE_INTERVAL ms after scene start.
    // Players see a HUD banner + 2× XP multiplier for SURGE_DURATION ms.
    this._startSurgeTimer();

    // ── Phase 5-C: Ambient sound tick — every ~3.5 s ──────────────────
    this.time.addEvent({
      delay: 3500, loop: true,
      callback: () => {
        if (!this._paused && this.sfx) {
          const ratio = this._nightAlpha / 0.55; // normalise 0–1
          this.sfx.tickAmbient(ratio);
        }
      },
    });

    // ── Tutorial (first visit only) ───────────────────────────────────
    if (!this.gameData.tutorialSeen) {
      this.time.delayedCall(400, () => this._showTutorial());
    }

    // Notify React shell that the scene is fully initialised — hides loading splash
    this.onComplete({ type: 'sceneReady' });
  }

  update(time, delta) {
    if (this._paused) return;
    const portals = this.portalMgr?.portals;
    if (this._portalLockId && portals && !this.physics.overlap(this.player, portals)) {
      this._portalLockId = null;
    }

    // Build combined input (keyboard + touch)
    const touch = this.hud?.touchKeys ?? {};
    const cursors = {
      left:  { isDown: this.cursors.left.isDown  || (touch.left?.isDown  ?? false) },
      right: { isDown: this.cursors.right.isDown || (touch.right?.isDown ?? false) },
      up:    { isDown: this.cursors.up.isDown    || (touch.up?.isDown    ?? false) },
      down:  { isDown: this.cursors.down.isDown  || (touch.down?.isDown  ?? false) },
    };

    updatePlayer(this.player, cursors, this.wasd, PLAYER_SPEED, delta);
    this.player.setDepth(ySort(this.player.y + 14));
    this.portalMgr?.update(this.player);

    if (this.isRespawnInvulnerable()) {
      const now = Date.now();
      if (now >= this._nextRespawnBlinkAt) {
        this._respawnBlinkOn = !this._respawnBlinkOn;
        this.player.setAlpha(this._respawnBlinkOn ? RESPAWN_BLINK_ALPHA : 1);
        this._nextRespawnBlinkAt = now + RESPAWN_BLINK_INTERVAL_MS;
      }
    } else if (this.player.alpha !== 1) {
      this.player.setAlpha(1);
      this._respawnBlinkOn = false;
      this._nextRespawnBlinkAt = 0;
    }

    // Attack on SPACE or touch attack button
    if (
      Phaser.Input.Keyboard.JustDown(this.spaceKey) ||
      (touch.attack?.isDown)
    ) {
      this.battle.playerAttack(this.player.weapon, this.enemies, this.player);
      this._spawnAttackVfx();
      this.sfx.playAttack(this.player.weapon ?? 'broom');
      playAttackAnim(this, this.player, 180); // show directional swing frame
    }

    // Level-up detection
    const curLevel = levelFromXp(this.gameData.xp);
    if (curLevel > this._lastLevel) {
      this._lastLevel = curLevel;
      this.sfx.playLevelUp();
      this._showLevelUpBanner(curLevel);
      // Persist immediately so a crash right after levelling doesn't lose progress
      writeSave({ ...this.gameData, userId: this.userId });
    }

    // Day/night cycle (10-minute sinusoidal loop, max alpha 0.55)
    const CYCLE_MS   = 10 * 60 * 1000;
    const phase      = ((this.time.now - this._cycleStart) % CYCLE_MS) / CYCLE_MS;
    const nightAlpha = 0.55 * 0.5 * (1 - Math.cos(2 * Math.PI * phase));
    this._nightAlpha = nightAlpha; // stored for ambient tick callback
    this._nightOverlay.setAlpha(nightAlpha);
    this._updateNightLights(nightAlpha / 0.55);
    this.hud.updateNightCycle(nightAlpha);
    // Enemies get up to 30% faster at peak night
    const nightBoost = 1 + nightAlpha * 0.55;

    // Update enemies (pass night speed boost via enemy.speed)
    this.enemies.getChildren().forEach((e) => {
      if (e.active) {
        e.speed = (e.baseSpeed ?? e.speed) * nightBoost;
        e.setDepth(ySort(e.y + e.displayHeight / 2 - 2));
      }
      updateEnemy(e, this.player, delta);
    });

    // Save player position to gameData continuously
    this.gameData.playerX = this.player.x;
    this.gameData.playerY = this.player.y;

    // Periodic save + adventure progress sync to server
    this._saveTick += delta;
    if (this._saveTick >= SAVE_INTERVAL) {
      this._saveTick = 0;
      writeSave({ ...this.gameData, userId: this.userId });
      // Sync to backend leaderboard — kids only (parents/admins in preview get 403, so skip)
      if (this.isKid) {
        const lvl = levelFromXp(this.gameData.xp);
        // api() JSON-encodes the body itself — passing a pre-stringified body
        // double-encoded it and the server rejected every sync with a 422.
        api('/api/progress/adventure/progress', {
          method: 'POST',
          body: { xp: this.gameData.xp, coins: this.gameData.coins, level: lvl },
        }).catch(() => {});
      }
    }

    // Phase 5-A: NPC proximity dialogue
    this.npc?.update(this.player);

    // Phase 5-C: Boss proximity music (checked every 60 frames to avoid cost)
    this._bossProxTick++;
    if (this._bossProxTick >= 60) {
      this._bossProxTick = 0;
      this._checkBossProximity();
    }

    this._updateShadows();

    // Update HUD
    this.hud.update(this.gameData);
  }

  // ── World dressing ──────────────────────────────────────────────────────

  _buildScenery() {
    const grid = this.worldGrid;
    // The layout is deterministic, so the ground only needs painting once
    if (!this.textures.exists('ground')) paintGround(this, grid);
    this.add.image(0, 0, 'ground').setOrigin(0).setDepth(DEPTH.GROUND);

    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const t = grid[r][c];
        const x = c * TILE_SIZE + TILE_SIZE / 2;
        const base = (r + 1) * TILE_SIZE;
        if (t === TILE.TREE_BOT) {
          const roll = tileHash(r, c, 30);
          const key = roll < 0.22 ? 'tree_pine' : `tree_${Math.floor(roll * 30) % 3}`;
          const ox = Math.round((tileHash(r, c, 31) - 0.5) * 6);
          this.add.image(x + ox, base - 3, 'shadow').setScale(1.15, 1).setDepth(DEPTH.SHADOW);
          this.add.image(x + ox, base - 2, key).setOrigin(0.5, 1).setDepth(ySort(base))
            .setFlipX(tileHash(r, c, 32) < 0.5);
        } else if (t === TILE.BUSH) {
          this.add.image(x, base - 5, 'shadow').setScale(0.8, 0.8).setDepth(DEPTH.SHADOW);
          this.add.image(x, base - 4, tileHash(r, c, 33) < 0.3 ? 'bush_berry' : 'bush')
            .setOrigin(0.5, 1).setDepth(ySort(base));
        } else if (t === TILE.ROCK) {
          this.add.image(x, base - 7, 'shadow').setScale(0.65, 0.7).setDepth(DEPTH.SHADOW);
          this.add.image(x, base - 6, 'rock').setOrigin(0.5, 1).setDepth(ySort(base));
        }
      }
    }

    this._addAmbientLife(grid);

    this.buildingFootprints = [];
    BUILDINGS.forEach((b) => {
      const x = (b.col + b.w / 2) * TILE_SIZE;
      const y = (b.row + b.h) * TILE_SIZE;
      this.add.image(x + 6, y - 2, 'shadow').setScale(b.w * 1.15, 1.3).setAlpha(0.8).setDepth(DEPTH.SHADOW);
      this.add.image(x, y, `bld_${b.style}`).setOrigin(0.5, 1).setDepth(ySort(y));
      this._addWindowLights(b, x, y);
      this.buildingFootprints.push({
        x: b.col * TILE_SIZE, y: b.row * TILE_SIZE, w: b.w * TILE_SIZE, h: b.h * TILE_SIZE,
        color: `#${(b.color ?? 0x888888).toString(16).padStart(6, '0')}`,
      });
    });
  }

  // Glints on the water and smoke from chimneys — small touches that make the
  // world feel alive. Positions are deterministic; timing is staggered.
  _addAmbientLife(grid) {
    let glints = 0;
    for (let r = 0; r < grid.length && glints < 60; r++) {
      for (let c = 0; c < grid[r].length && glints < 60; c++) {
        if (grid[r][c] !== TILE.WATER || tileHash(r, c, 50) > 0.09) continue;
        glints++;
        const g = this.add.rectangle(
          c * TILE_SIZE + 6 + tileHash(r, c, 51) * 20, r * TILE_SIZE + 8 + tileHash(r, c, 52) * 16,
          6, 2, 0xffffff, 0.9,
        ).setDepth(DEPTH.DECAL).setAlpha(0);
        this.tweens.add({
          targets: g, alpha: 0.85, scaleX: 1.6,
          duration: 600, yoyo: true, repeat: -1,
          delay: tileHash(r, c, 53) * 4000, repeatDelay: 1800 + tileHash(r, c, 54) * 3000,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // Chimney smoke (kitchen + library have chimneys; see WorldArt STYLES)
    BUILDINGS.filter((b) => b.style === 'kitchen' || b.style === 'library').forEach((b) => {
      const cx = (b.col + b.w / 2) * TILE_SIZE;
      const top = (b.row + b.h) * TILE_SIZE - 128;
      const sx = cx - 48 + 37 * 2;   // chimney centre in WorldArt design px × 2
      const sy = top + 2;
      this.time.addEvent({
        delay: 700, loop: true,
        callback: () => {
          if (this._paused) return;
          const puff = this.add.circle(sx + Phaser.Math.Between(-2, 2), sy, Phaser.Math.Between(3, 5), 0xe8edf2, 0.75)
            .setDepth(DEPTH.NIGHT - 1);
          this.tweens.add({
            targets: puff, y: sy - 42, x: puff.x + Phaser.Math.Between(4, 14),
            scale: 2.2, alpha: 0, duration: 2600, ease: 'Sine.easeOut',
            onComplete: () => puff.destroy(),
          });
        },
      });
    });
  }

  // Warm window glows that fade in as night falls (drawn above the night tint)
  _addWindowLights(b, cx, bottom) {
    this._nightLights = this._nightLights ?? [];
    const spots = b.style === 'castle'
      // offsets from the sprite's bottom-centre, matching WorldArt window positions
      ? [[-63, -90], [-63, -54], [61, -90], [61, -54], [0, -24]]
      : [[-26, -44], [24, -44], [0, -14]];
    spots.forEach(([dx, dy], i) => {
      const isDoor = i === spots.length - 1;
      const light = this.add.image(cx + dx, bottom + dy, 'soft_glow')
        .setTint(isDoor ? (b.color ?? 0xffd27a) : 0xffc66b)
        .setScale(isDoor ? 1.6 : 1.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.NIGHT + 1)
        .setAlpha(0);
      this._nightLights.push(light);
    });
  }

  _updateNightLights(ratio) {
    const a = Math.max(0, Math.min(1, (ratio - 0.15) / 0.6));
    if (Math.abs(a - (this._nightLightAlpha ?? -1)) < 0.01) return;
    this._nightLightAlpha = a;
    this._nightLights?.forEach((l) => l.setAlpha(a * 0.85));
  }

  _isBlockedAt(x, y) {
    const tile = this.worldLayer?.getTileAtWorldXY(x, y);
    return !!tile?.collides;
  }

  // Soft ground shadow that follows a character
  _addShadow(target, scale, dy) {
    const img = this.add.image(target.x, target.y + dy, 'shadow').setScale(scale).setDepth(DEPTH.SHADOW);
    this._shadows.push({ target, img, dy });
  }

  _updateShadows() {
    this._shadows = this._shadows.filter(({ target, img, dy }) => {
      if (!target.scene || !target.active) {
        img.destroy();
        return false;
      }
      img.setPosition(target.x, target.y + dy).setAlpha(target.alpha).setVisible(target.visible);
      return true;
    });
  }

  _spawnAttackVfx() {
    const weapon  = this.player.weapon ?? 'broom';
    const facing  = this.player.facing ?? 'down';
    const offsets = { down: [0, 32], up: [0, -32], left: [-32, 0], right: [32, 0] };
    const [ox, oy] = offsets[facing] ?? [0, 32];
    const isHoriz  = (facing === 'left' || facing === 'right');
    const px = this.player.x + ox;
    const py = this.player.y + oy;

    if (weapon === 'broom') {
      // Diagonal slash arc: two crossing rectangles in NES yellow
      const ang = isHoriz ? 0 : Math.PI / 2;
      const vfx1 = this.add.rectangle(px, py, 40, 8, 0xfcd860, 0.9)
        .setDepth(DEPTH.VFX).setRotation(ang + Math.PI / 4);
      const vfx2 = this.add.rectangle(px, py, 40, 8, 0xfcd860, 0.9)
        .setDepth(DEPTH.VFX).setRotation(ang - Math.PI / 4);
      [vfx1, vfx2].forEach((v) => {
        this.tweens.add({
          targets: v, alpha: 0, scaleX: 1.6, scaleY: 1.6,
          duration: 180, ease: 'Power2', onComplete: () => v.destroy(),
        });
      });
      return;
    }

    if (weapon === 'vacuum') {
      // Rectangular "blast" beam extending from player in facing direction
      const vfx = this.add.rectangle(
        px, py,
        isHoriz ? 48 : 28, isHoriz ? 28 : 48,
        0x6888fc, 0.80
      ).setDepth(DEPTH.VFX);
      this.tweens.add({
        targets: vfx, alpha: 0, scaleX: 2, scaleY: 2,
        duration: 220, ease: 'Power1', onComplete: () => vfx.destroy(),
      });
      return;
    }

    if (weapon === 'soap') {
      // Splatter: 5 small orange droplets radiating outward
      for (let i = 0; i < 5; i++) {
        const baseAngle = Math.atan2(oy, ox);
        const spread    = (Math.PI / 3);
        const a         = baseAngle + (i - 2) * (spread / 4);
        const drop      = this.add.rectangle(
          this.player.x, this.player.y, 6, 6, 0xfc7820, 0.9,
        ).setDepth(DEPTH.VFX);
        this.tweens.add({
          targets: drop,
          x: this.player.x + Math.cos(a) * 36,
          y: this.player.y + Math.sin(a) * 36,
          alpha: 0, scaleX: 0.3, scaleY: 0.3,
          duration: 200, ease: 'Power1', onComplete: () => drop.destroy(),
        });
      }
      return;
    }

    if (weapon === 'sponge') {
      // Radial burst — ring of 8 white squares expanding outward
      for (let i = 0; i < 8; i++) {
        const a    = (Math.PI * 2 * i) / 8;
        const puff = this.add.rectangle(
          this.player.x, this.player.y, 8, 8, 0xfcfcfc, 0.85,
        ).setDepth(DEPTH.VFX);
        this.tweens.add({
          targets: puff,
          x: this.player.x + Math.cos(a) * 56,
          y: this.player.y + Math.sin(a) * 56,
          alpha: 0, scaleX: 0.5, scaleY: 0.5,
          duration: 280, ease: 'Power2', onComplete: () => puff.destroy(),
        });
      }
      return;
    }

    // Fallback: original white sweep
    const vfx = this.add.rectangle(
      px, py, isHoriz ? 24 : 48, isHoriz ? 48 : 24, 0xffffff, 0.85,
    ).setDepth(DEPTH.VFX);
    this.tweens.add({
      targets: vfx, alpha: 0, scaleX: 1.8, scaleY: 1.8,
      duration: 180, ease: 'Power2', onComplete: () => vfx.destroy(),
    });
  }

  _spawnCoinDrop(x, y, count) {
    // Spawn up to 4 coin sprites that float toward the player and disappear
    const visual = Math.min(count, 4);
    for (let i = 0; i < visual; i++) {
      this.time.delayedCall(i * 55, () => {
        if (!this.player?.active) return;
        const coin = this.add.sprite(x, y, 'coin').setDepth(DEPTH.VFX);
        if (this.anims.exists('coin_spin')) coin.play('coin_spin');
        // Arc outward briefly, then sweep to player
        const angle = (Math.PI * 2 * i) / visual;
        const midX  = x + Math.cos(angle) * 18;
        const midY  = y + Math.sin(angle) * 18;
        this.tweens.add({
          targets: coin, x: midX, y: midY, duration: 120, ease: 'Power1',
          onComplete: () => {
            this.tweens.add({
              targets: coin,
              x: this.player.x, y: this.player.y,
              alpha: 0, duration: 260, ease: 'Power2',
              onComplete: () => coin.destroy(),
            });
          },
        });
      });
    }
  }

  _handlePlayerDeath() {
    if (this.player.isAlive === false) return; // already dying — don't queue a second restart
    this.player.isAlive = false;
    this.player.body.setVelocity(0, 0);
    this.physics.pause();
    this._setGameplayTimersPaused(true);

    const { w, h } = uiSize(this);

    // 1. Player sprite: spin + shrink to nothing
    this.tweens.add({
      targets: this.player,
      angle: 360,
      scaleX: 0, scaleY: 0,
      alpha: 0,
      duration: 600,
      ease: 'Power2',
    });

    // 2. Screen darkens gradually after the sprite finishes
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0)
      .setScrollFactor(0).setDepth(200);
    this.tweens.add({
      targets: overlay, alpha: 0.75,
      delay: 400, duration: 500, ease: 'Power1',
    });

    // 3. "YOU FAINTED" slides down from above with a bounce
    const faintTxt = this.add.text(w / 2, h / 2 - h * 0.4, 'You fainted!', textStyle(30, COLORS.red, { weight: 900, stroke: 6 }))
      .setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);
    this.tweens.add({
      targets: faintTxt,
      y: h / 2 - 20,
      alpha: 1,
      delay: 700,
      duration: 400,
      ease: 'Bounce.easeOut',
    });

    // 4. Respawn sub-text fades in below
    const respawnTxt = this.add.text(w / 2, h / 2 + 22, 'Back on your feet with 3 hearts…', textStyle(14, COLORS.text, { weight: 600, stroke: 4 }))
      .setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);
    this.tweens.add({
      targets: respawnTxt, alpha: 1,
      delay: 1200, duration: 300,
    });

    this.time.delayedCall(2800, () => {
      this.gameData.hp = Math.min(3, this.gameData.maxHp);
      const fallback = { x: 640, y: 640 };
      const safeRespawn = pickRespawnPoint({
        enemies: this.enemies?.getChildren() ?? [],
        fallback,
        candidates: [
          { x: 224, y: 224 },
          { x: 1056, y: 224 },
          { x: 224, y: 1056 },
          { x: 1056, y: 1056 },
        ],
      });
      this.gameData.playerX = safeRespawn.x;
      this.gameData.playerY = safeRespawn.y;

      // Explicitly stop and destroy the SoundSystem before restarting the
      // scene.  scene.restart() queues a shutdown+start pair that executes on
      // the next frame; by the time the SHUTDOWN event runs _cleanup() the Web
      // Audio scheduler may have already pre-queued another 16-second music
      // loop.  Destroying here (with gain ramped to 0) guarantees the old
      // music stops immediately, regardless of Phaser's lifecycle timing.
      if (this.sfx) {
        this.sfx.destroy();
        this.sfx = null;
      }

      this.scene.restart({
        userId: this.userId, userName: this.userName,
        gameData: this.gameData, tileMap: this.tileMap,
        respawnInvulnerableUntil: Date.now() + RESPAWN_INVULNERABILITY_MS,
        onExit: this.onExit, onComplete: this.onComplete,
        isKid: this.isKid,
      });
    });
  }

  _togglePause() {
    this._paused = !this._paused;
    if (this._paused) {
      this.physics.pause();
      this._setGameplayTimersPaused(true);
      this._showPauseMenu();
    } else {
      this.physics.resume();
      this._setGameplayTimersPaused(false);
      if (this._pauseOverlay) {
        this._pauseOverlay.destroy();
        this._pauseOverlay = null;
      }
    }
  }

  _showPauseMenu() {
    const { w, h } = uiSize(this);
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(300);

    const dim = this.add.rectangle(w / 2, h / 2, w, h, 0x05070c, 0.6);
    const panelW = Math.min(w - 32, 280);
    const panelH = 196;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;
    const panel = drawPanel(this.add.graphics(), px, py, panelW, panelH, { radius: 14, alpha: 0.94 });

    const title = this.add.text(w / 2, py + 34, 'Paused', textStyle(22, COLORS.text, { weight: 800, stroke: 0 }))
      .setOrigin(0.5);
    const hint = this.add.text(w / 2, py + panelH - 20, 'Press Esc to resume', textStyle(11, COLORS.muted, { weight: 500, stroke: 0 }))
      .setOrigin(0.5);

    const resumeBtn = this._makePauseBtn(w / 2, py + 84, panelW - 48, 'Resume', () => this._togglePause(), true);
    const exitBtn   = this._makePauseBtn(w / 2, py + 132, panelW - 48, 'Exit Adventure', () => this._exitGame(), false);

    container.add([dim, panel, title, hint, ...resumeBtn, ...exitBtn]);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 140 });
    this._pauseOverlay = container;
  }

  _makePauseBtn(x, y, width, text, cb, primary) {
    const fill  = primary ? COLORS.goldHex : 0x232a3a;
    const hover = primary ? 0xffe28a : 0x2f384c;
    const bg = this.add.rectangle(x, y, width, 38, fill, 1)
      .setScrollFactor(0)                   // must precede setInteractive so hit area aligns
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', cb)
      .on('pointerover',  () => bg.setFillStyle(hover))
      .on('pointerout',   () => bg.setFillStyle(fill));
    if (!primary) bg.setStrokeStyle(1, 0xffffff, 0.14);
    const label = this.add.text(x, y, text, textStyle(14, primary ? COLORS.ink : COLORS.text, { stroke: 0 }))
      .setOrigin(0.5).setScrollFactor(0);
    return [bg, label];
  }

  _showTutorial() {
    this._paused = true;
    this.physics.pause();
    this._setGameplayTimersPaused(true);

    const { w, h } = uiSize(this);
    const cx = w / 2;
    const isTouch = this.sys.game.device.input.touch;
    const twoCol  = w >= 560;

    const controls = [
      ['🕹', 'Move',    isTouch ? 'Joystick, bottom left' : 'Arrow keys or W A S D', COLORS.sky],
      ['⚔', 'Attack',  isTouch ? 'Sword button, bottom right' : 'Space bar',        COLORS.orange],
      ['✨', 'Portals', 'Walk into a glowing doorway to see your quests',           COLORS.green],
      ['💰', 'Coins',   'Beat enemies and finish chores to earn them',              COLORS.gold],
      ['🏰', 'Weapons', 'Buy upgrades at the Reward Castle',                        COLORS.red],
      ['⏸', 'Pause',   isTouch ? 'Tap Exit to leave any time' : 'Esc',             COLORS.muted],
    ];

    const panelW = Math.min(w - 24, twoCol ? 560 : 400);
    const colW   = twoCol ? (panelW - 56) / 2 : panelW - 40;
    const ROW_H  = twoCol ? 58 : 50;
    const rows   = twoCol ? Math.ceil(controls.length / 2) : controls.length;
    const HEAD_H = 78;
    const FOOT_H = 84;
    const panelH = Math.min(h - 16, HEAD_H + rows * ROW_H + FOOT_H);
    const top    = (h - panelH) / 2;
    const left   = cx - panelW / 2;

    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(400);
    const dim   = this.add.rectangle(cx, h / 2, w, h, 0x05070c, 0.72);
    const panel = drawPanel(this.add.graphics(), left, top, panelW, panelH, { radius: 16, alpha: 0.96 });
    const accent = this.add.graphics();
    accent.fillStyle(COLORS.goldHex, 1);
    accent.fillRoundedRect(left + panelW / 2 - 28, top + 12, 56, 4, 2);
    container.add([dim, panel, accent]);

    container.add([
      this.add.text(cx, top + 38, 'Welcome to Adventure Mode', textStyle(20, COLORS.text, { weight: 800, stroke: 0 })).setOrigin(0.5),
      this.add.text(cx, top + 62, 'Do chores → earn XP & coins → level up your hero', textStyle(12, COLORS.muted, { weight: 500, stroke: 0 })).setOrigin(0.5),
    ]);

    const gridTop = top + HEAD_H;
    controls.forEach(([icon, action, desc, color], idx) => {
      const col = twoCol ? idx % 2 : 0;
      const row = twoCol ? Math.floor(idx / 2) : idx;
      const x = left + 20 + col * (colW + 16);
      const y = gridTop + row * ROW_H;

      const chip = this.add.graphics();
      chip.fillStyle(0xffffff, 0.06);
      chip.fillRoundedRect(x, y, colW, ROW_H - 8, 10);
      const iconT = this.add.text(x + 22, y + (ROW_H - 8) / 2, icon, textStyle(18, color, { stroke: 0, weight: 400 }))
        .setOrigin(0.5);
      const actT = this.add.text(x + 42, y + 8, action, textStyle(13, color, { stroke: 0 }));
      const descT = this.add.text(x + 42, y + 26, desc, textStyle(11, COLORS.text, {
        stroke: 0, weight: 500, align: 'left', wordWrap: { width: colW - 52, useAdvancedWrap: true },
      }));
      container.add([chip, iconT, actT, descT]);
    });

    const btnY  = top + panelH - FOOT_H / 2 - 6;
    const btnBg = this.add.rectangle(cx, btnY, Math.min(panelW - 48, 280), 42, COLORS.goldHex)
      .setInteractive({ useHandCursor: true });
    const btnTxt = this.add.text(cx, btnY, "Let's go!", textStyle(15, COLORS.ink, { weight: 800, stroke: 0 })).setOrigin(0.5);
    const btnSub = this.add.text(cx, btnY + 32, isTouch ? 'Tap the button to start' : 'or press any key', textStyle(11, COLORS.muted, { weight: 500, stroke: 0 })).setOrigin(0.5);
    container.add([btnBg, btnTxt, btnSub]);

    // ── Dismiss logic ─────────────────────────────────────────────────
    const dismiss = () => {
      container.destroy();
      this._paused = false;
      this.physics.resume();
      this.gameData.tutorialSeen = true;
      this._setGameplayTimersPaused(false);
      writeSave({ ...this.gameData, userId: this.userId });
      this.input.keyboard.off('keydown', dismiss);
    };

    btnBg.on('pointerdown', dismiss);
    btnBg.on('pointerover',  () => btnBg.setFillStyle(0xffe28a));
    btnBg.on('pointerout',   () => btnBg.setFillStyle(COLORS.goldHex));
    this.input.keyboard.once('keydown', dismiss);

    // Panel slides in from below for a polished entrance
    container.setAlpha(0).setY(24);
    this.tweens.add({ targets: container, alpha: 1, y: 0, duration: 260, ease: 'Power2' });
  }

  _showLevelUpBanner(level) {
    const { w, h } = uiSize(this);

    // Screen flash
    const flash = this.add.rectangle(w / 2, h / 2, w, h, 0xffffff, 0)
      .setScrollFactor(0).setDepth(200);
    this.tweens.add({
      targets: flash, alpha: 0.35,
      yoyo: true, duration: 100, repeat: 1,
      onComplete: () => flash.destroy(),
    });

    const title = this.add.text(w / 2, h * 0.36 + 10, 'LEVEL UP!', textStyle(30, COLORS.gold, { weight: 900, stroke: 6 }))
      .setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);
    const sub = this.add.text(w / 2, h * 0.36 + 44, `You reached level ${level}`, textStyle(15, COLORS.text, { stroke: 4 }))
      .setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: [title, sub], alpha: 1, y: '-=26',
      duration: 320, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: [title, sub], alpha: 0, y: '-=30',
          delay: 1300, duration: 500, ease: 'Power2',
          onComplete: () => { title.destroy(); sub.destroy(); },
        });
      },
    });
  }

  // ── Phase 5-A: Chore Surge ────────────────────────────────────────────────────

  _startSurgeTimer() {
    this._surgeTimer?.remove(false);
    this._surgeTimer = this.time.delayedCall(SURGE_INTERVAL, () => {
      this._surgeTimer = null;
      this._activateSurge();
    });
    this._surgeTimer.paused = this._paused || !this.gameData.tutorialSeen;
  }

  _activateSurge() {
    if (this._surgeActive) return; // shouldn't happen, but guard
    this._surgeActive = true;
    this.hud.showSurgeBanner(SURGE_DURATION);
    this.sfx?.playSurge();

    // Screen tint pulse: brief gold flash to signal the event
    const { w: sw, h: sh } = uiSize(this);
    const flash = this.add.rectangle(sw / 2, sh / 2, sw, sh, 0xfcd860, 0)
      .setScrollFactor(0).setDepth(199);
    this.tweens.add({
      targets: flash, alpha: 0.18,
      yoyo: true, duration: 180, repeat: 2,
      onComplete: () => flash.destroy(),
    });

    // End surge after SURGE_DURATION, then restart the inter-surge timer
    this._surgeEndTimer?.remove(false);
    this._surgeEndTimer = this.time.delayedCall(SURGE_DURATION, () => {
      this._surgeEndTimer = null;
      this._surgeActive = false;
      this._startSurgeTimer(); // schedule the next one
    });
    this._surgeEndTimer.paused = this._paused;
  }

  _setGameplayTimersPaused(paused) {
    const shouldPause = paused || !this.gameData.tutorialSeen;
    if (this._surgeTimer) this._surgeTimer.paused = shouldPause;
    if (this._surgeEndTimer) this._surgeEndTimer.paused = paused;
    this.chestSystem?.setPaused(paused);
    this.npc?.setPaused(paused);
    this.hud?.setPaused(paused);
  }

  // ── Phase 5-C: Boss proximity music ──────────────────────────────────────────

  _checkBossProximity() {
    if (!this.sfx || !this.player) return;
    const BOSS_MUSIC_RANGE = 220; // pixels — bosses have a 3× sprite scale, range feels fair
    let nearBoss = false;
    this.enemies.getChildren().forEach((e) => {
      if (!e.active || !e.isBoss) return;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (dx * dx + dy * dy < BOSS_MUSIC_RANGE * BOSS_MUSIC_RANGE) nearBoss = true;
    });

    if (nearBoss && !this._nearBoss) {
      this._nearBoss = true;
      this.sfx.startBossMusic();
    } else if (!nearBoss && this._nearBoss) {
      this._nearBoss = false;
      this.sfx.stopBossMusic();
    }
  }

  _exitGame() {
    writeSave({ ...this.gameData, userId: this.userId });
    this.onExit();
  }

  // Runs on the scene SHUTDOWN event (fired before restart/stop/destroy).
  // A method literally named `shutdown` is NOT called automatically by Phaser —
  // it must be wired to the event, which create() does.
  _cleanup() {
    // Remove only the handlers this scene instance registered, so listeners
    // other systems add on the same event names are left alone.
    (this._gameplayListeners ?? []).forEach(([evt, fn]) => this.events.off(evt, fn));
    this._gameplayListeners = [];
    this.sfx?.destroy();
    this.sfx = null;
    this.chestSystem?.destroy();
    this.chestSystem = null;
    this.npc?.destroy();
    this.npc = null;
  }

  // scene.events.on() wrapper that records the handler so _cleanup() can
  // remove exactly it (Phaser keeps scene.events listeners across restarts).
  _onGameplay(evt, fn) {
    this.events.on(evt, fn);
    this._gameplayListeners.push([evt, fn]);
  }

  isRespawnInvulnerable() {
    return Date.now() < this._respawnInvulnerableUntil;
  }
}
