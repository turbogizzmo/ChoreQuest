// Lightweight battle resolution — no turn-based menu, just collision-driven.
// Player swings weapon -> emits 'playerAttack' event.
// Enemy touches player -> triggers damage.

import { WEAPON_STATS } from '../data/WorldData.js';
import { uiSize } from '../engine/view.js';

const COMBO_WINDOW_MS = 1500; // hits within this window count toward combo

// Death-puff colour per enemy type (anything else puffs white)
const DEATH_TINT = {
  dust_bunny:      0xbcbcbc,
  crumb_slime:     0x9be15d,
  sock_goblin:     0xc084fc,
  mop_golem:       0x7dd3fc,
  trash_bag_ghost: 0x94a3b8,
};

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

  /** 0 right after a swing → 1 when the weapon is ready again (for the HUD). */
  cooldownProgress(weapon) {
    const cd = WEAPON_STATS[weapon]?.cooldown ?? 500;
    return Math.min(1, (Date.now() - (this.cooldowns[weapon] || 0)) / cd);
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

    // Contact sparks on every hit; bosses also get a micro shake and a
    // short freeze so heavy hits read as heavy
    this.scene.juice.burst(enemy.x, enemy.y, { count: 5, tint: 0xfff2b0 });
    if (enemy.isBoss) {
      this.scene.juice.shake(80, 0.005);
      this.scene.juice.hitStop(55);
    }

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

    // Recompute combo multiplier from the live hit window rather than the cached
    // value — this prevents a stale 2× bonus lingering after the window expires.
    const cutoff   = Date.now() - COMBO_WINDOW_MS;
    const liveHits = this._recentHits.filter(t => t > cutoff);
    const mult     = liveHits.length >= 5 ? 3 : liveHits.length >= 3 ? 2 : 1;
    const xpDrop   = Math.round((enemy.xpDrop   ?? 2) * mult);
    const coinDrop = Math.round((enemy.coinDrop ?? 1) * (mult > 1 ? 1.5 : 1));
    this.scene.events.emit('enemyDefeated', { enemy, xpDrop, coinDrop });

    // Kill feedback: freeze, shake and a puff in the enemy's colour
    const juice = this.scene.juice;
    juice.hitStop(enemy.isBoss ? 120 : 35);
    juice.shake(enemy.isBoss ? 260 : 70, enemy.isBoss ? 0.012 : 0.003);
    juice.burst(enemy.x, enemy.y, {
      kind: 'puffs',
      count: enemy.isBoss ? 28 : 12,
      tint: DEATH_TINT[enemy.enemyType] ?? 0xffffff,
    });

    this._playDeathAnimation(enemy);
  }

  _playDeathAnimation(enemy) {
    const scene = this.scene;
    const type  = enemy.enemyType;

    if (enemy.isBoss) {
      // Boss: big flash + dramatic scale-burst
      const { w, h } = uiSize(scene);
      // One pulse, not a strobe: the old yoyo+repeat flashed ~4×/s, above the
      // 3-flashes-per-second photosensitivity limit.
      const flash = scene.add.rectangle(w / 2, h / 2, w, h, 0xffffff, 0).setScrollFactor(0).setDepth(200);
      scene.juice.flash(flash, 0.45);
      scene.tweens.add({
        targets: enemy, alpha: 0, scaleX: 4, scaleY: 4,
        duration: 500, ease: 'Power2',
        onComplete: () => enemy.destroy(),
      });
      return;
    }

    if (type === 'dust_bunny') {
      // Dust bunny: squash flat (the puff burst comes from defeatEnemy)
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

    if (type === 'sock_goblin') {
      // Sock goblin: spin like a thrown sock, then stretch-snap and vanish
      scene.tweens.add({
        targets: enemy, angle: 360, scaleX: 1.6, scaleY: 0.4,
        duration: 160, ease: 'Power2',
        onComplete: () => {
          scene.tweens.add({
            targets: enemy, alpha: 0, scaleX: 0.4, scaleY: 2.0,
            duration: 180, ease: 'Power1',
            onComplete: () => enemy.destroy(),
          });
        },
      });
      return;
    }

    // Default (any future enemy type): scale + fade
    scene.tweens.add({
      targets: enemy, alpha: 0, scaleX: 2, scaleY: 2,
      duration: 300, onComplete: () => enemy.destroy(),
    });
  }

  // Called when an enemy overlaps the player
  enemyContactDamage(player, enemy) {
    const now  = Date.now();
    if (this.scene.isRespawnInvulnerable?.()) return;
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

    // Screen shake + white flash + a short freeze so the hit registers
    // (all skipped under prefers-reduced-motion)
    this.scene.juice.shake(150, 0.008);
    this.scene.juice.hitStop(70);

    const { w, h } = uiSize(this.scene);
    const flash = this.scene.add.rectangle(w / 2, h / 2, w, h, 0xffffff, 0).setScrollFactor(0).setDepth(210);
    this.scene.juice.flash(flash, 0.55);

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
