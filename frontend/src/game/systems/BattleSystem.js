// Lightweight battle resolution — no turn-based menu, just collision-driven.
// Player swings weapon -> emits 'playerAttack' event.
// Enemy touches player -> triggers damage.

import { WEAPON_STATS } from '../data/WorldData.js';

const COMBO_WINDOW_MS = 1500; // hits within this window count toward combo

export class BattleSystem {
  constructor(scene) {
    this.scene   = scene;
    this.cooldowns = {};
    this._recentHits      = [];  // timestamps of recent hits
    this._comboMultiplier = 1;
    this._lastComboMult   = 1;
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

    // Directional facing vector for arc check
    const facingVec = {
      down:  [  0,  1],
      up:    [  0, -1],
      left:  [ -1,  0],
      right: [  1,  0],
    }[playerSprite.facing ?? 'down'] ?? [0, 1];

    // Sponge (throw) hits full circle; melee weapons use a 120° front arc.
    // cos(60°) = 0.5 — dot product threshold for ±60° half-angle = 120° cone.
    const isRanged = (weapon === 'sponge');
    const ARC_DOT  = 0.5; // 0.5 = cos 60° → 120° full cone

    enemies.getChildren().forEach((enemy) => {
      if (!enemy.active) return;
      const dx = enemy.x - playerSprite.x;
      const dy = enemy.y - playerSprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range) return;
      if (!isRanged) {
        // dist === 0 means the enemy is directly on top of the player — always in-arc.
        // Otherwise compute dot product of normalised enemy direction vs facing direction.
        if (dist > 0) {
          const dot = (dx / dist) * facingVec[0] + (dy / dist) * facingVec[1];
          if (dot < ARC_DOT) return; // outside the forward 120° cone
        }
      }
      this.hurtEnemy(enemy, damage);
      hit++;
    });

    // ── Combo tracker ────────────────────────────────────────────────────
    if (hit > 0) {
      const now2 = Date.now();
      this._recentHits.push(now2);
    }
    // Clean hits older than the combo window
    const cutoff = Date.now() - COMBO_WINDOW_MS;
    this._recentHits = this._recentHits.filter(t => t > cutoff);

    const count    = this._recentHits.length;
    const newMult  = count >= 5 ? 3 : count >= 3 ? 2 : 1;
    if (hit > 0 && newMult > 1) {
      this._lastComboMult   = newMult;
      this._comboMultiplier = newMult;
      this.scene.events.emit('comboHit', { multiplier: newMult });
    } else if (count < 3) {
      this._lastComboMult   = 1;
      this._comboMultiplier = 1;
    }

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
    // blocks any second hit during the death tween, preventing double XP/coins.
    enemy.setActive(false);
    enemy.body?.setEnable(false); // also disable physics body so overlaps stop firing

    // Cleanup boss UI elements
    enemy._hpBarBg?.destroy();
    enemy._hpBarFill?.destroy();
    enemy._nameTag?.destroy();

    // Apply combo multiplier to XP; coins get a smaller boost
    const mult     = this._comboMultiplier;
    const xpDrop   = Math.round((enemy.xpDrop   ?? 2) * mult);
    const coinDrop = Math.round((enemy.coinDrop ?? 1) * (mult > 1 ? 1.5 : 1));
    this.scene.events.emit('enemyDefeated', { enemy, xpDrop, coinDrop });

    this._playDeathAnimation(enemy);
  }

  _playDeathAnimation(enemy) {
    const scene = this.scene;
    const type  = enemy.enemyType;

    if (enemy.isBoss) {
      // Boss: big flash + dramatic scale-burst
      const cam = scene.cameras.main;
      const flash = scene.add.rectangle(
        cam.width / 2, cam.height / 2, cam.width, cam.height,
        0xffffff, 0,
      ).setScrollFactor(0).setDepth(200);
      scene.tweens.add({
        targets: flash, alpha: 0.45,
        yoyo: true, duration: 120, repeat: 1,
        onComplete: () => flash.destroy(),
      });
      scene.tweens.add({
        targets: enemy, alpha: 0, scaleX: 4, scaleY: 4,
        duration: 500, ease: 'Power2',
        onComplete: () => enemy.destroy(),
      });
      return;
    }

    if (type === 'dust_bunny') {
      // Dust bunny: scatter into 6 tiny white pixel puffs
      for (let i = 0; i < 6; i++) {
        const angle  = (Math.PI * 2 * i) / 6;
        const puff   = scene.add.rectangle(enemy.x, enemy.y, 4, 4, 0xbcbcbc, 1)
          .setDepth(12);
        scene.tweens.add({
          targets: puff,
          x: enemy.x + Math.cos(angle) * 28,
          y: enemy.y + Math.sin(angle) * 28,
          alpha: 0, scaleX: 0.3, scaleY: 0.3,
          duration: 280, ease: 'Power1',
          onComplete: () => puff.destroy(),
        });
      }
      scene.tweens.add({
        targets: enemy, alpha: 0, scaleX: 1.8, scaleY: 0.3,
        duration: 180, onComplete: () => enemy.destroy(),
      });
      return;
    }

    if (type === 'crumb_slime') {
      // Slime: flatten and fade like a splat
      scene.tweens.add({
        targets: enemy,
        alpha: 0.7, scaleX: 2.5, scaleY: 0.4,
        duration: 120, ease: 'Power2',
        onComplete: () => {
          scene.tweens.add({
            targets: enemy, alpha: 0, duration: 200,
            onComplete: () => enemy.destroy(),
          });
        },
      });
      return;
    }

    // Default (sock_goblin and any future enemy): scale + fade
    scene.tweens.add({
      targets: enemy, alpha: 0, scaleX: 2, scaleY: 2,
      duration: 300, onComplete: () => enemy.destroy(),
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

    // Blink the player sprite for the full 1-second i-frame window so the
    // player always knows when they're protected (6 blinks × 85ms yoyo ≈ 1 s).
    this.scene.tweens.add({
      targets: player,
      alpha: 0.25,
      yoyo: true,
      repeat: 5,
      duration: 85,
      onComplete: () => player.setAlpha(1),
    });

    // Screen shake + white flash — much more impactful than a red tint
    this.scene.cameras.main.shake(150, 0.008);

    const cam   = this.scene.cameras.main;
    const flash = this.scene.add.rectangle(
      cam.width / 2, cam.height / 2, cam.width, cam.height, 0xffffff, 0.55,
    ).setScrollFactor(0).setDepth(210);
    this.scene.tweens.add({
      targets: flash, alpha: 0, duration: 200,
      onComplete: () => flash.destroy(),
    });

    // Also tint the player sprite briefly
    this.scene.tweens.add({
      targets: player,
      tint: 0xffffff,
      duration: 80,
      yoyo: true,
      repeat: 2,
      onComplete: () => player.clearTint(),
    });
  }
}
