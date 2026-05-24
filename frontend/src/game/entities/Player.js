// Player entity — Phaser Physics Sprite with 4-direction walk animation.
// Animation key convention: player_down/up/left/right (3 frames each).

export const PLAYER_SPEED = 120;

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
      frameRate: 6,
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

  return player;
}

// Play the directional attack frame for `durationMs`, then return to idle
export function playAttackAnim(scene, player, durationMs = 180) {
  const dir = player.facing ?? 'down';
  player.play(`player_attack_${dir}`, true);
  scene.time.delayedCall(durationMs, () => {
    if (player.active) player.play(`player_${dir}_idle`, true);
  });
}

export function updatePlayer(player, cursors, wasd, speed = PLAYER_SPEED) {
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

  // Direction + animation
  if (vx < 0)      { player.facing = 'left';  player.play('player_left',  true); }
  else if (vx > 0) { player.facing = 'right'; player.play('player_right', true); }
  else if (vy < 0) { player.facing = 'up';    player.play('player_up',    true); }
  else if (vy > 0) { player.facing = 'down';  player.play('player_down',  true); }
  else             { player.play(`player_${player.facing}_idle`, true); }
}
