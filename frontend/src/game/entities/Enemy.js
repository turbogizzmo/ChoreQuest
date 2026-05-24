// Enemy entity factory — creates animated enemies that wander and chase the player.

import { ENEMY_STATS } from '../data/WorldData.js';

export function createEnemyAnimations(scene) {
  const keys = Object.keys(ENEMY_STATS);
  keys.forEach((key) => {
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

export function spawnEnemy(scene, type, x, y) {
  const stats  = ENEMY_STATS[type] ?? ENEMY_STATS.dust_bunny;
  const texKey = `enemy_${type}`;

  const enemy    = scene.physics.add.sprite(x, y, texKey);
  enemy.enemyType = type;
  enemy.hp       = stats.hp;
  enemy.maxHp    = stats.hp;
  enemy.xpDrop   = stats.xp;
  enemy.coinDrop = stats.coins;
  enemy.speed    = stats.speed;
  enemy.label    = stats.name;
  enemy.setDepth(9);
  enemy.setCollideWorldBounds(true);

  const animKey = `enemy_${type}_walk`;
  if (scene.anims.exists(animKey)) enemy.play(animKey);

  // Wander state
  enemy.wanderTimer  = 0;
  enemy.wanderAngle  = Math.random() * Math.PI * 2;
  enemy.chasing      = false;

  return enemy;
}

export function updateEnemy(enemy, playerSprite, delta) {
  if (!enemy.active) return;

  const dx   = playerSprite.x - enemy.x;
  const dy   = playerSprite.y - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Chase if within 120 px
  if (dist < 120) {
    enemy.chasing = true;
    const nx  = dx / dist;
    const ny  = dy / dist;
    enemy.body.setVelocity(nx * enemy.speed, ny * enemy.speed);
    return;
  }

  enemy.chasing = false;
  // Wander
  enemy.wanderTimer -= delta;
  if (enemy.wanderTimer <= 0) {
    enemy.wanderTimer  = 1500 + Math.random() * 2000;
    enemy.wanderAngle  = Math.random() * Math.PI * 2;
  }

  const wx = Math.cos(enemy.wanderAngle) * (enemy.speed * 0.5);
  const wy = Math.sin(enemy.wanderAngle) * (enemy.speed * 0.5);
  enemy.body.setVelocity(wx, wy);
}
