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
import { PORTAL_ZONES, ENEMY_ZONES, BOSS_ZONES, BOSS_STATS, TILE_SIZE, MAP_COLS, levelFromXp, SURGE_INTERVAL, SURGE_DURATION, SURGE_XP_MULT } from '../data/WorldData.js';
import { ChestSystem } from '../systems/ChestSystem.js';
import { NPC }         from '../entities/NPC.js';
import { api } from '../../api/client.js';

const HUD_DEPTH = 100;

const SAVE_INTERVAL = 15000; // ms
const RESPAWN_INVULNERABILITY_MS = 3000;
const RESPAWN_BLINK_ALPHA = 0.65;
const RESPAWN_BLINK_INTERVAL_MS = 120;

export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data) {
    this.userId    = data.userId;
    this.userName  = data.userName;
    this.isKid     = data.isKid ?? false;  // gates backend progress-sync; parents get local-only saves
    this.gameData  = { ...data.gameData };
    this.tileMap   = data.tileMap;
    this.onExit    = data.onExit    ?? (() => {});
    this.onComplete = data.onComplete ?? (() => {});

    this._portalCooldown = 0;
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
    // ── Tilemap ────────────────────────────────────────────────────────
    const { map, layer } = buildWorldTilemap(this);
    this.worldLayer = layer;

    // ── Player ─────────────────────────────────────────────────────────
    this.player = createPlayer(
      this,
      this.gameData.playerX,
      this.gameData.playerY,
    );
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // Collision: player <-> world tiles
    this.physics.add.collider(this.player, layer);

    // ── Enemies ────────────────────────────────────────────────────────
    createEnemyAnimations(this);
    this.enemies = this.physics.add.group();
    ENEMY_ZONES.forEach((zone) => {
      for (let i = 0; i < zone.count; i++) {
        const jx = zone.x * TILE_SIZE + (Math.random() - 0.5) * TILE_SIZE * 2;
        const jy = zone.y * TILE_SIZE + (Math.random() - 0.5) * TILE_SIZE * 2;
        const enemy = spawnEnemy(this, zone.type, jx, jy);
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
    this.events.on('enemyHurt', ({ enemy, damage }) => {
      // Show damage number over every hit — makes attacks feel responsive
      this.hud.showFloatingText(enemy.x, enemy.y - 16, `-${damage}`, '#ff4444');
    });

    this.events.on('enemyDefeated', ({ enemy, xpDrop, coinDrop }) => {
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

    this.events.on('comboHit', ({ multiplier }) => {
      this.hud.showCombo(multiplier);    // persistent HUD counter
      this.hud.showFloatingText(         // floating pop for immediate impact
        this.player.x, this.player.y - 48,
        `${multiplier}× COMBO!`,
        multiplier >= 3 ? '#ff4444' : '#ff8800',
      );
      this.sfx.playCombo(multiplier);
    });
    this.events.on('playerHurt', ({ damage }) => {
      this.gameData.hp = Math.max(0, this.gameData.hp - damage);
      this.sfx.playPlayerHurt();
      if (this.gameData.hp <= 0) this._handlePlayerDeath();
    });

    // ── Portal entry ───────────────────────────────────────────────────
    this.events.on('portalEnter', (zoneData) => {
      const now = Date.now();
      if (now - this._portalCooldown < 2000) return;
      this._portalCooldown = now;
      this.sfx.playPortalEnter();
      this.onComplete({ type: 'portalEnter', zone: zoneData, gameData: this.gameData });
    });

    // ── Day/night cycle overlay ────────────────────────────────────────
    // Cycles from clear (day) to dark blue (night) over 10 real minutes.
    // Depth 8: above tiles but below sprites (player is depth 10).
    const worldPx = MAP_COLS * TILE_SIZE;
    this._nightOverlay = this.add.rectangle(
      worldPx / 2, worldPx / 2, worldPx, worldPx, 0x000033, 0,
    ).setDepth(8);
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
    const banner = this.add.text(
      this.scale.width / 2, 20,
      'Home Realm — Broken Village',
      { fontSize: '10px', fontFamily: 'monospace', color: '#fcd860',
        stroke: '#000000', strokeThickness: 3, resolution: 2 }
    ).setScrollFactor(0).setDepth(50).setOrigin(0.5);
    this.tweens.add({ targets: banner, alpha: 0, delay: 3000, duration: 1000 });

    // ── Exit button ───────────────────────────────────────────────────
    const exitBtn = this.add.text(
      this.scale.width - 8, 8, '[EXIT]',
      { fontSize: '8px', fontFamily: 'monospace', color: '#ff6644',
        stroke: '#000', strokeThickness: 2, resolution: 2 }
    ).setScrollFactor(0).setDepth(HUD_DEPTH + 5).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    exitBtn.on('pointerdown', () => this._exitGame());

    // ── Phase 5-A: Chest loot system ──────────────────────────────────
    this.chestSystem = new ChestSystem(this);
    this.events.on('chestCollect', ({ coins, xp }) => {
      this.gameData.coins += coins;
      this.gameData.xp    += xp;
      this.sfx.playCoinPickup();
      this.hud.showFloatingText(
        this.player?.x ?? 320, this.player?.y ?? 240,
        `+${coins}¢  +${xp} XP`, '#fcd860',
      );
    });

    // ── Phase 5-A: NPC shopkeeper (2 tiles right + 1 tile above castle portal)
    // Castle is at tile (19, 18); place NPC at (22, 16) — visible but not blocking
    this.npc = new NPC(this, 22, 16);

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

    // Build combined input (keyboard + touch)
    const touch = this.hud?.touchKeys ?? {};
    const cursors = {
      left:  { isDown: this.cursors.left.isDown  || (touch.left?.isDown  ?? false) },
      right: { isDown: this.cursors.right.isDown || (touch.right?.isDown ?? false) },
      up:    { isDown: this.cursors.up.isDown    || (touch.up?.isDown    ?? false) },
      down:  { isDown: this.cursors.down.isDown  || (touch.down?.isDown  ?? false) },
    };

    updatePlayer(this.player, cursors, this.wasd, PLAYER_SPEED, delta);

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
    this.hud.updateNightCycle(nightAlpha);
    // Enemies get up to 30% faster at peak night
    const nightBoost = 1 + nightAlpha * 0.55;

    // Update enemies (pass night speed boost via enemy.speed)
    this.enemies.getChildren().forEach((e) => {
      if (e.active) e.speed = (e.baseSpeed ?? e.speed) * nightBoost;
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
        api('/api/progress/adventure/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xp: this.gameData.xp, coins: this.gameData.coins, level: lvl }),
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

    // Update HUD
    this.hud.update(this.gameData);
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
        .setDepth(12).setRotation(ang + Math.PI / 4);
      const vfx2 = this.add.rectangle(px, py, 40, 8, 0xfcd860, 0.9)
        .setDepth(12).setRotation(ang - Math.PI / 4);
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
      ).setDepth(12);
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
        ).setDepth(12);
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
        ).setDepth(12);
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
    ).setDepth(12);
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
        const coin = this.add.sprite(x, y, 'coin').setScale(2).setDepth(11);
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
    this.player.isAlive = false;
    this.player.body.setVelocity(0, 0);
    this.physics.pause();
    this._setGameplayTimersPaused(true);

    const w = this.scale.width;
    const h = this.scale.height;

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
    const faintTxt = this.add.text(w / 2, h / 2 - h * 0.4, 'YOU FAINTED', {
      fontSize: '22px', fontFamily: 'monospace', color: '#ff4444',
      stroke: '#000', strokeThickness: 5, resolution: 2,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);
    this.tweens.add({
      targets: faintTxt,
      y: h / 2 - 20,
      alpha: 1,
      delay: 700,
      duration: 400,
      ease: 'Bounce.easeOut',
    });

    // 4. Respawn sub-text fades in below
    const respawnTxt = this.add.text(w / 2, h / 2 + 20, 'Respawning with 3 hearts...', {
      fontSize: '9px', fontFamily: 'monospace', color: '#888888',
      stroke: '#000', strokeThickness: 2, resolution: 2,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);
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
      // the next frame; by the time Phaser's own shutdown() fires the Web
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
    const w = this.scale.width;
    const h = this.scale.height;
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(300);

    const bg = this.add.rectangle(w / 2, h / 2, 200, 160, 0x000000, 0.85).setScrollFactor(0);
    const title = this.add.text(w / 2, h / 2 - 55, '— PAUSED —', {
      fontSize: '14px', fontFamily: 'monospace', color: '#fcd860',
      stroke: '#000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5).setScrollFactor(0);

    const resumeBtn = this._makePauseBtn(w / 2, h / 2 - 20, 'Resume', () => this._togglePause());
    const exitBtn   = this._makePauseBtn(w / 2, h / 2 + 20, 'Exit Adventure', () => this._exitGame());

    container.add([bg, title, resumeBtn.bg, resumeBtn.label, exitBtn.bg, exitBtn.label]);
    this._pauseOverlay = container;
  }

  _makePauseBtn(x, y, text, cb) {
    const bg = this.add.rectangle(x, y, 140, 24, 0x2a2a2a, 1)
      .setScrollFactor(0)                   // must precede setInteractive so hit area aligns
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', cb)
      .on('pointerover',  () => bg.setFillStyle(0x444444))
      .on('pointerout',   () => bg.setFillStyle(0x2a2a2a));
    const label = this.add.text(x, y, text, {
      fontSize: '10px', fontFamily: 'monospace', color: '#ffffff', resolution: 2,
    }).setOrigin(0.5).setScrollFactor(0);
    return { bg, label };
  }

  _showTutorial() {
    this._paused = true;
    this.physics.pause();
    this._setGameplayTimersPaused(true);

    const w  = this.scale.width;
    const h  = this.scale.height;
    const cx = w / 2;
    const cy = h / 2;

    // Panel dimensions — wider and taller than the original for legibility
    const panelW = Math.min(w - 20, 440);
    const isTouch = this.sys.game.device.input.touch;
    // Compute panel height from content so nothing is clipped on small screens
    const TITLE_H   = 56;  // title + subtitle + divider
    const GRID_ROWS = 3;
    const ROW_H     = 54;
    const TOUCH_H   = isTouch ? 28 : 0;
    const BTN_H     = 54;  // divider + button + sub-label
    const VPAD      = 20;  // top + bottom padding
    const panelH    = Math.min(h - 16, TITLE_H + GRID_ROWS * ROW_H + TOUCH_H + BTN_H + VPAD * 2);
    const top       = cy - panelH / 2;

    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(400);

    // ── Backdrop + panel ──────────────────────────────────────────────
    const dim   = this.add.rectangle(cx, cy, w, h, 0x000000, 0.82);
    const panel = this.add.rectangle(cx, cy, panelW, panelH, 0x0d0d1e, 1)
      .setStrokeStyle(2, 0xfcd860);
    // NES-style corner accent dots
    const cornerOffsets = [
      [-panelW / 2 + 5,  -panelH / 2 + 5],
      [ panelW / 2 - 5,  -panelH / 2 + 5],
      [-panelW / 2 + 5,   panelH / 2 - 5],
      [ panelW / 2 - 5,   panelH / 2 - 5],
    ];
    const corners = cornerOffsets.map(([ox, oy]) =>
      this.add.rectangle(cx + ox, cy + oy, 4, 4, 0xfcd860)
    );
    container.add([dim, panel, ...corners]);

    // ── Title block ───────────────────────────────────────────────────
    const titleY = top + VPAD + 14;
    const titleTxt = this.add.text(cx, titleY,
      '⚔  ADVENTURE MODE  ⚔', {
        fontSize: '13px', fontFamily: 'monospace', color: '#fcd860',
        stroke: '#000', strokeThickness: 3, resolution: 2,
      }).setOrigin(0.5);
    const subTxt = this.add.text(cx, titleY + 18,
      'Complete chores  ›  earn XP & coins  ›  level up!', {
        fontSize: '8px', fontFamily: 'monospace', color: '#666688',
        stroke: '#000', strokeThickness: 2, resolution: 2,
      }).setOrigin(0.5);
    const divTop = this.add.rectangle(cx, titleY + 32, panelW - 28, 1, 0x2a2a4a);
    container.add([titleTxt, subTxt, divTop]);

    // ── Controls grid (2 columns × 3 rows) ───────────────────────────
    // Each entry: [col, icon, action, keyHint, description, accentColor]
    const controls = [
      [0, '◈', 'MOVE',    '[ ↑↓←→ ]  or  [ W A S D ]', 'Walk around the Home Realm',       '#6888fc'],
      [0, '◉', 'PORTALS', 'Walk into a glowing portal',  'Opens your chore quest list',       '#58d854'],
      [0, '▸', 'PAUSE',   '[ ESC ]',                     'Pause or open the menu',            '#bcbcbc'],
      [1, '✦', 'ATTACK',  '[ SPACE ]',                   'Swing your weapon at enemies',      '#fca044'],
      [1, '◎', 'COINS',   'Defeat enemies + do chores',  'Spend at the Reward Castle  ★',    '#fcd860'],
      [1, '⚔', 'WEAPONS', 'Visit the Reward Castle',     'Buy upgrades with your coins',      '#f87858'],
    ];

    const gridTop  = top + TITLE_H + VPAD;
    const colLx    = cx - panelW / 2 + 16;
    const colRx    = cx + 4;

    controls.forEach(([col, icon, action, key, desc, color], idx) => {
      const row = idx % GRID_ROWS;   // 0–2
      const lx  = col === 0 ? colLx : colRx;
      const ry  = gridTop + row * ROW_H;

      const iconT = this.add.text(lx, ry + 10, icon, {
        fontSize: '15px', fontFamily: 'monospace', color,
        stroke: '#000', strokeThickness: 3, resolution: 2,
      }).setOrigin(0, 0.5);

      const actT = this.add.text(lx + 22, ry + 1, action, {
        fontSize: '10px', fontFamily: 'monospace', color: '#e5e5e5',
        stroke: '#000', strokeThickness: 2, resolution: 2,
      }).setOrigin(0, 0);

      const keyT = this.add.text(lx + 22, ry + 16, key, {
        fontSize: '8px', fontFamily: 'monospace', color,
        stroke: '#000', strokeThickness: 2, resolution: 2,
      }).setOrigin(0, 0);

      const descT = this.add.text(lx + 22, ry + 30, desc, {
        fontSize: '7px', fontFamily: 'monospace', color: '#777799',
        stroke: '#000', strokeThickness: 1, resolution: 2,
      }).setOrigin(0, 0);

      container.add([iconT, actT, keyT, descT]);
    });

    // Column divider line (between the two columns)
    const colDiv = this.add.rectangle(cx - 2, gridTop + (GRID_ROWS * ROW_H) / 2,
      1, GRID_ROWS * ROW_H - 8, 0x2a2a4a);
    container.add([colDiv]);

    // ── Touch controls hint (only on touch devices) ───────────────────
    let touchBottom = gridTop + GRID_ROWS * ROW_H;
    if (isTouch) {
      const touchDivY = touchBottom + 4;
      const touchDiv  = this.add.rectangle(cx, touchDivY, panelW - 28, 1, 0x2a2a4a);
      const touchTxt  = this.add.text(cx, touchDivY + 14,
        '📱  Joystick (bottom-left)   +   ⚔ button (bottom-right)', {
          fontSize: '7px', fontFamily: 'monospace', color: '#555577',
          stroke: '#000', strokeThickness: 2, resolution: 2,
        }).setOrigin(0.5);
      container.add([touchDiv, touchTxt]);
      touchBottom += TOUCH_H;
    }

    // ── Dismiss button ────────────────────────────────────────────────
    const btnDivY = touchBottom + 8;
    const btnDiv  = this.add.rectangle(cx, btnDivY, panelW - 28, 1, 0x2a2a4a);
    const btnY    = btnDivY + 22;
    const btnBg   = this.add.rectangle(cx, btnY, panelW - 56, 28, 0xfcd860)
      .setInteractive({ useHandCursor: true });
    const btnTxt  = this.add.text(cx, btnY, '►  LET\'S GO!  ◄', {
      fontSize: '12px', fontFamily: 'monospace', color: '#0d0d1e',
      stroke: '#000000', strokeThickness: 1, resolution: 2,
    }).setOrigin(0.5);
    const btnSub  = this.add.text(cx, btnY + 20, 'or press any key', {
      fontSize: '7px', fontFamily: 'monospace', color: '#555555', resolution: 2,
    }).setOrigin(0.5);
    container.add([btnDiv, btnBg, btnTxt, btnSub]);

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
    btnBg.on('pointerover',  () => btnBg.setFillStyle(0xffe080));
    btnBg.on('pointerout',   () => btnBg.setFillStyle(0xfcd860));
    this.input.keyboard.once('keydown', dismiss);

    // Panel slides in from below for a polished entrance
    container.setAlpha(0).setY(30);
    this.tweens.add({
      targets: container, alpha: 1, y: 0,
      duration: 280, ease: 'Power2',
    });
  }

  _showLevelUpBanner(level) {
    const w = this.scale.width;
    const h = this.scale.height;

    // Screen flash
    const cam   = this.cameras.main;
    const flash = this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0xffffff, 0)
      .setScrollFactor(0).setDepth(200);
    this.tweens.add({
      targets: flash, alpha: 0.45,
      yoyo: true, duration: 100, repeat: 1,
      onComplete: () => flash.destroy(),
    });

    // Big golden "LEVEL UP!" text that rises and fades
    const txt = this.add.text(w / 2, h / 2 + 10, `✦  LEVEL UP!  LV ${level}  ✦`, {
      fontSize: '16px', fontFamily: 'monospace', color: '#fcd860',
      stroke: '#000000', strokeThickness: 5, resolution: 2,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: txt, alpha: 1, y: h / 2 - 20,
      duration: 300, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: txt, alpha: 0, y: h / 2 - 60,
          delay: 1200, duration: 500, ease: 'Power2',
          onComplete: () => txt.destroy(),
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
    const cam   = this.cameras.main;
    const flash = this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0xfcd860, 0)
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

  shutdown() {
    this.sfx?.destroy();
    this.chestSystem?.destroy();
    this.npc?.destroy();
  }

  isRespawnInvulnerable() {
    return Date.now() < this._respawnInvulnerableUntil;
  }
}
