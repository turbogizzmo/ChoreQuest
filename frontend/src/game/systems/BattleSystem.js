// Lightweight battle resolution — no turn-based menu, just collision-driven.
// Player swings weapon -> emits 'playerAttack' event.
// Enemy touches player -> triggers damage.

import { WEAPON_STATS } from '../data/WorldData.js';

export class BattleSystem {
  constructor(scene) {
    this.scene   = scene;
    this.cooldowns = {};
  }

  canAttack(weapon) {
    const now  = Date.now();
    const last = this.cooldowns[weapon] || 0;
    return now - last >= (WEAPON_STATS[weapon]?.cooldown ?? 500);
  }

  // Returns damage dealt (or 0 if on cooldown)
  playerAttack(weapon, enemies, playerSprite) {
    if (!this.canAttack(weapon)) return 0;
    this.cooldowns[weapon] = Date.now();

    const stats  = WEAPON_STATS[weapon] ?? WEAPON_STATS.broom;
    const range  = stats.range;
    const damage = stats.damage;
    let   hit    = 0;

    enemies.getChildren().forEach((enemy) => {
      if (!enemy.active) return;
      const dx = enemy.x - playerSprite.x;
      const dy = enemy.y - playerSprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= range) {
        this.hurtEnemy(enemy, damage);
        hit++;
      }
    });
    return hit;
  }

  hurtEnemy(enemy, damage) {
    if (!enemy.active) return;
    enemy.hp = (enemy.hp ?? enemy.maxHp) - damage;
    this.scene.events.emit('enemyHurt', { enemy, damage });

    // Bright red tint flash — much more readable than an alpha dip
    enemy.setTint(0xff2222);
    this.scene.tweens.add({
      targets: enemy,
      alpha: 0.5,
      duration: 60,
      yoyo: true,
      repeat: 1,
      onComplete: () => { enemy.clearTint(); enemy.setAlpha(1); },
    });

    if (enemy.hp <= 0) {
      this.defeatEnemy(enemy);
    }
  }

  defeatEnemy(enemy) {
    // Mark inactive immediately so hurtEnemy's `if (!enemy.active) return` guard
    // blocks any second hit during the 300 ms death tween, preventing double XP/coins.
    enemy.setActive(false);
    enemy.body?.setEnable(false); // also disable physics body so overlaps stop firing

    const xpDrop   = enemy.xpDrop   ?? 2;
    const coinDrop = enemy.coinDrop ?? 1;
    this.scene.events.emit('enemyDefeated', { enemy, xpDrop, coinDrop });

    this.scene.tweens.add({
      targets: enemy,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 300,
      onComplete: () => enemy.destroy(),
    });
  }

  // Called when an enemy overlaps the player
  enemyContactDamage(player, enemy) {
    const now  = Date.now();
    const key  = `player_iframes`;
    const last = this.cooldowns[key] || 0;
    if (now - last < 1000) return; // 1 s invincibility
    this.cooldowns[key] = now;

    this.scene.events.emit('playerHurt', { damage: 1 });

    // Red flash on player
    this.scene.tweens.add({
      targets: player,
      tint: 0xff0000,
      duration: 100,
      yoyo: true,
      repeat: 3,
      onComplete: () => player.clearTint(),
    });
  }
}
