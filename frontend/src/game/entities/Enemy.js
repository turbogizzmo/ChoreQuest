// Enemy entity factory — creates animated enemies that wander and chase the player.

import { ENEMY_STATS, BOSS_STATS } from '../data/WorldData.js';
import Phaser from 'phaser';
import { DEPTH, ySort } from '../engine/depth.js';
import { textStyle, COLORS } from '../ui/theme.js';

const BOSS_BAR_DY  = 40;
const BOSS_NAME_DY = 46;

export function createEnemyAnimations(scene) {
  const allTypes = [...Object.keys(ENEMY_STATS), ...Object.keys(BOSS_STATS)];
  allTypes.forEach((key) => {
    const texKey = `enemy_${key}`;
    if (!scene.textures.exists(texKey)) return;
    const animKey = `${texKey}_walk`;
    if (scene.anims.exists(animKey)) return;
    scene.anims.create({
      key: animKey,
      frames: scene.anims.generateFrameNumbers(texKey, { start: 0, end: 1 }),
      frameRate: 3,
      repeat: -1,
    });
  });
}

export function spawnEnemy(scene, type, x, y, isBoss = false) {
  const stats  = isBoss
    ? (BOSS_STATS[type] ?? BOSS_STATS.grime_lord)
    : (ENEMY_STATS[type] ?? ENEMY_STATS.dust_bunny);
  const texKey = `enemy_${type}`;

  const enemy      = scene.physics.add.sprite(x, y, texKey);
  enemy.enemyType  = type;
  enemy.isBoss     = isBoss;
  enemy.hp         = stats.hp;
  enemy.maxHp      = stats.hp;
  enemy.xpDrop     = stats.xp;
  enemy.coinDrop   = stats.coins;
  enemy.baseSpeed  = stats.speed;
  enemy.speed      = stats.speed;
  enemy.label      = stats.name;
  enemy.setDepth(ySort(y));
  enemy.setCollideWorldBounds(true);

  if (isBoss) {
    enemy.setScale(2); // 32 px texture → 64 px: two tiles tall, imposing but not screen-filling

    // Boss charge state machine (shared across all boss types)
    enemy._chargeState  = 'idle';
    enemy._chargeTimer  = 3000 + Math.random() * 2000; // ms until first charge
    enemy._windupDur    = 0;
    enemy._chargeDur    = 0;
    enemy._chargeVx     = 0;
    enemy._chargeVy     = 0;

    // Type-specific behaviour flags
    if (type === 'lint_titan') {
      // Lint Titan: long root wind-up (600 ms) then a fast 3.5× burst lunge.
      // Using _burstSpeed so the charge logic in updateEnemy reads it automatically.
      enemy._burstSpeed    = stats.speed * 3.5;
      enemy._rootDur       = 600; // ms frozen during wind-up
    }
    if (type === 'paper_wraith') {
      // Paper Wraith: teleports to a random position near the player when HP drops below 50%
      enemy._hasTeleported = false;
    }

    // HP bar above the head (32 px half-height + margin)
    const hpBg   = scene.add.rectangle(x, y - BOSS_BAR_DY, 52, 6, 0x330000, 0.9).setDepth(DEPTH.LABEL);
    const hpFill = scene.add.rectangle(x - 26, y - BOSS_BAR_DY, 52, 6, 0xff2222, 1)
      .setOrigin(0, 0.5).setDepth(DEPTH.LABEL + 0.1);
    enemy._hpBarBg   = hpBg;
    enemy._hpBarFill = hpFill;

    // Boss name tag
    enemy._nameTag = scene.add.text(x, y - BOSS_NAME_DY, stats.name, textStyle(12, COLORS.red, { weight: 900, stroke: 4 }))
      .setOrigin(0.5, 1).setDepth(DEPTH.LABEL + 0.2);
  }

  const animKey = `enemy_${type}_walk`;
  if (scene.anims.exists(animKey)) enemy.play(animKey);

  // Wander state
  enemy.wanderTimer = 0;
  enemy.wanderAngle = Math.random() * Math.PI * 2;
  enemy.chasing     = false;

  return enemy;
}

export function updateEnemy(enemy, playerSprite, delta) {
  if (!enemy.active) return;

  const dx   = playerSprite.x - enemy.x;
  const dy   = playerSprite.y - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // ── Boss-specific logic ──────────────────────────────────────────────────────
  if (enemy.isBoss) {
    // Track HP bar + name tag
    if (enemy._hpBarBg)   enemy._hpBarBg.setPosition(enemy.x, enemy.y - BOSS_BAR_DY);
    if (enemy._hpBarFill) {
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      enemy._hpBarFill.setPosition(enemy.x - 26, enemy.y - BOSS_BAR_DY);
      enemy._hpBarFill.width = 52 * ratio;
    }
    if (enemy._nameTag) enemy._nameTag.setPosition(enemy.x, enemy.y - BOSS_NAME_DY);

    // Charge state machine
    if (enemy._chargeState === 'charging') {
      enemy._chargeDur -= delta;
      enemy.body.setVelocity(enemy._chargeVx, enemy._chargeVy);
      if (enemy._chargeDur <= 0) {
        enemy._chargeState = 'idle';
        enemy._chargeTimer = 3000 + Math.random() * 2000;
        enemy.clearTint();
      }
      return;
    }

    if (enemy._chargeState === 'windup') {
      enemy._windupDur -= delta;
      // Lint Titan roots in place during wind-up (already handled: velocity=0)
      enemy.body.setVelocity(0, 0);
      if (enemy._windupDur <= 0) {
        enemy._chargeState = 'charging';
        enemy._chargeDur   = 450;
        const nd = dist || 1;
        // Lint Titan uses its pre-set _burstSpeed; other bosses multiply base speed
        const chargeSpeed = enemy._burstSpeed ?? (enemy.baseSpeed * 3);
        enemy._chargeVx = (dx / nd) * chargeSpeed;
        enemy._chargeVy = (dy / nd) * chargeSpeed;
        // Orange tint during the actual dash — stays until charge ends so player
        // can still see the danger window
        enemy.setTint(0xff8800);
      }
      return;
    }

    // ── Paper Wraith phase-shift (teleport at 50% HP) ─────────────────────────
    if (enemy.enemyType === 'paper_wraith' && !enemy._hasTeleported) {
      if (enemy.hp <= enemy.maxHp * 0.5) {
        enemy._hasTeleported = true;
        // Fade out → reposition near player → fade in
        const scene = enemy.scene;
        const uiParts = [enemy._hpBarBg, enemy._hpBarFill, enemy._nameTag].filter(Boolean);
        enemy.setAlpha(0);
        uiParts.forEach((part) => part.setAlpha(0));
        // Pick a position 80–140px away from the player at a random angle,
        // clamped to world bounds so the boss never lands outside the map.
        const teleportAngle = Math.random() * Math.PI * 2;
        const teleportDist  = 80 + Math.random() * 60;
        const bounds = scene.physics.world.bounds;
        const margin = 32; // keep the boss sprite inside the visible area
        const tx = Phaser.Math.Clamp(
          playerSprite.x + Math.cos(teleportAngle) * teleportDist,
          bounds.x + margin, bounds.right  - margin,
        );
        const ty = Phaser.Math.Clamp(
          playerSprite.y + Math.sin(teleportAngle) * teleportDist,
          bounds.y + margin, bounds.bottom - margin,
        );
        enemy.setPosition(tx, ty);
        scene.tweens.add({ targets: [enemy, ...uiParts], alpha: 1, duration: 300 });
        scene.sfx?.playBossWarning?.();
      }
    }

    // Idle — count down to next charge when player is nearby
    if (dist < 200) {
      enemy._chargeTimer -= delta;
      if (enemy._chargeTimer <= 0) {
        enemy._chargeState = 'windup';
        // Lint Titan has a longer, more dramatic root wind-up
        enemy._windupDur = enemy._rootDur ?? 350;
        enemy.setTint(0xffff00); // yellow flash = warning
        enemy.scene?.sfx?.playBossWarning?.();
      }
    }
  }

  // ── Directional flip ─────────────────────────────────────────────────────────
  // Flip sprite so it always faces the direction it's moving
  if (enemy.body.velocity.x < -5)       enemy.setFlipX(true);
  else if (enemy.body.velocity.x > 5)   enemy.setFlipX(false);

  // ── Chase/wander ─────────────────────────────────────────────────────────────
  const chaseRange = enemy.isBoss ? 180 : 120;
  if (dist < chaseRange) {
    enemy.chasing = true;
    const nx = dx / (dist || 1);
    const ny = dy / (dist || 1);
    enemy.body.setVelocity(nx * enemy.speed, ny * enemy.speed);
    return;
  }

  enemy.chasing = false;
  enemy.wanderTimer -= delta;
  if (enemy.wanderTimer <= 0) {
    enemy.wanderTimer = 1500 + Math.random() * 2000;
    enemy.wanderAngle = Math.random() * Math.PI * 2;
  }

  const wx = Math.cos(enemy.wanderAngle) * (enemy.speed * 0.5);
  const wy = Math.sin(enemy.wanderAngle) * (enemy.speed * 0.5);
  enemy.body.setVelocity(wx, wy);
}
