// Player entity — Phaser Physics Sprite with 4-direction walk animation.
// Animation key convention: player_down/up/left/right (3 frames each).

export const PLAYER_SPEED = 120;
const MIN_FRAME_DELTA_MS = 8;
const DEFAULT_FRAME_DELTA_MS = 16;
const MAX_FRAME_DELTA_MS = 50;
const WALK_STRETCH_FACTOR = 0.05;
const WALK_SQUASH_RATIO = 0.65;
const WALK_SWAY_DEGREES = 4;
const IDLE_BREATH_X = 0.015;
const IDLE_BREATH_Y = 0.012;
const IDLE_SWAY_DEGREES = 1.5;

export function createPlayerAnimations(scene) {
  const anims = scene.anims;
  if (anims.exists('player_down')) return;

  // Frame layout:
  //   0–11  walk (dir*3 + walkFrame): dir 0=down, 1=left, 2=right, 3=up
  //   12–15 attack (down, left, right, up)
  const dirMap = { down: 0, left: 1, right: 2, up: 3 };
  Object.entries(dirMap).forEach(([dir, dirIdx]) => {
    const start = dirIdx * 3;
    anims.create({
      key: `player_${dir}`,
      frames: anims.generateFrameNumbers('player', { start, end: start + 2 }),
      frameRate: 9,
      repeat: -1,
    });
    anims.create({
      key: `player_${dir}_idle`,
      frames: anims.generateFrameNumbers('player', { start, end: start }),
      frameRate: 1,
      repeat: -1,
    });
  });

  // Attack animations — single-frame held for 180ms then snap back to idle
  const attackFrameMap = { down: 12, left: 13, right: 14, up: 15 };
  Object.entries(attackFrameMap).forEach(([dir, frame]) => {
    anims.create({
      key: `player_attack_${dir}`,
      frames: anims.generateFrameNumbers('player', { start: frame, end: frame }),
      frameRate: 1,
      repeat: 0,
    });
  });
}

export function createPlayer(scene, x, y) {
  createPlayerAnimations(scene);

  const player = scene.physics.add.sprite(x, y, 'player');
  player.setCollideWorldBounds(true);
  player.setDepth(10);
  player.play('player_down_idle');

  // State
  player.facing  = 'down';
  player.weapon  = 'broom';
  player.isAlive = true;
  player._motionPhase = Math.random() * Math.PI * 2;

  return player;
}

// Play the directional attack frame for `durationMs`, then return to idle
export function playAttackAnim(scene, player, durationMs = 180) {
  const dir = player.facing ?? 'down';
  if (player._attackResetTimer) {
    player._attackResetTimer.remove(false);
    player._attackResetTimer = null;
  }
  player._attackLockUntil = scene.time.now + durationMs;
  player.play(`player_attack_${dir}`, true);
  player._attackResetTimer = scene.time.delayedCall(durationMs, () => {
    player._attackResetTimer = null;
    if (player.active) player.play(`player_${dir}_idle`, true);
  });
}

export function updatePlayer(player, cursors, wasd, speed = PLAYER_SPEED, delta = DEFAULT_FRAME_DELTA_MS) {
  if (!player.isAlive) return;

  const body = player.body;
  let vx = 0;
  let vy = 0;

  const left  = cursors.left.isDown  || wasd.left.isDown;
  const right = cursors.right.isDown || wasd.right.isDown;
  const up    = cursors.up.isDown    || wasd.up.isDown;
  const down  = cursors.down.isDown  || wasd.down.isDown;

  if (left)  vx -= speed;
  if (right) vx += speed;
  if (up)    vy -= speed;
  if (down)  vy += speed;

  // Normalize diagonal
  if (vx !== 0 && vy !== 0) {
    vx *= 0.707;
    vy *= 0.707;
  }

  body.setVelocity(vx, vy);
  const moving = vx !== 0 || vy !== 0;

  const dSec = Math.max(MIN_FRAME_DELTA_MS, Math.min(delta || DEFAULT_FRAME_DELTA_MS, MAX_FRAME_DELTA_MS)) / 1000;
  player._motionPhase = (player._motionPhase ?? 0) + dSec * (moving ? 12 : 4);
  const wave = Math.sin(player._motionPhase);

  if (moving) {
    const stretch = Math.abs(wave) * WALK_STRETCH_FACTOR;
    player.setScale(1 + stretch, 1 - (stretch * WALK_SQUASH_RATIO));
    player.setAngle(wave * WALK_SWAY_DEGREES);
  } else {
    player.setScale(1 + (wave * IDLE_BREATH_X), 1 - (wave * IDLE_BREATH_Y));
    player.setAngle(wave * IDLE_SWAY_DEGREES);
  }

  const attackLocked = (player._attackLockUntil ?? 0) > player.scene.time.now;
  if (attackLocked) return;

  // Direction + animation
  if (vx < 0)      { player.facing = 'left';  player.play('player_left',  true); }
  else if (vx > 0) { player.facing = 'right'; player.play('player_right', true); }
  else if (vy < 0) { player.facing = 'up';    player.play('player_up',    true); }
  else if (vy > 0) { player.facing = 'down';  player.play('player_down',  true); }
  else             { player.play(`player_${player.facing}_idle`, true); }
}
