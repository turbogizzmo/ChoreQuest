// Shared "game feel" helpers: hit-stop, camera shake, screen flashes,
// particle bursts and pooled floating text. Everything motion-heavy respects
// prefers-reduced-motion, and flashes never repeat (stays under 3 flashes/s).

import { DEPTH } from '../engine/depth.js';
import { textStyle, COLORS } from '../ui/theme.js';

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export class Juice {
  constructor(scene) {
    this.scene = scene;
    this.stopUntil = 0;
    this._textPool = [];
    makeFxTextures(scene);

    // One emitter per look; explode() recycles particles instead of creating
    // a rectangle + tween per puff.
    this.sparks = scene.add.particles(0, 0, 'fx_dot', {
      emitting: false,
      lifespan: { min: 220, max: 420 },
      speed: { min: 60, max: 170 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
    }).setDepth(DEPTH.VFX_GLOW);

    this.puffs = scene.add.particles(0, 0, 'fx_dot', {
      emitting: false,
      lifespan: 380,
      speed: { min: 20, max: 70 },
      scale: { start: 1.4, end: 0.2 },
      alpha: { start: 0.8, end: 0 },
      gravityY: -30,
    }).setDepth(DEPTH.VFX);
  }

  /** True while a hit-stop freeze is in effect. */
  get stopped() {
    return this.scene.time.now < this.stopUntil;
  }

  /** Freeze the world for a few ms on impact. UI tweens keep running. */
  hitStop(ms) {
    const { physics, anims, time } = this.scene;
    if (prefersReducedMotion() || this.stopped || physics.world.isPaused) return;
    this.stopUntil = time.now + ms;
    physics.world.pause();
    anims.pauseAll();
    time.delayedCall(ms, () => {
      anims.resumeAll();
      // The pause menu, tutorial and death screen also pause physics — never
      // resume over them.
      if (!this.scene._paused && this.scene.player?.isAlive !== false) physics.world.resume();
    });
  }

  shake(durationMs, intensity) {
    if (!prefersReducedMotion()) this.scene.cameras.main.shake(durationMs, intensity);
  }

  /** Single full-screen pulse on an existing overlay rect, which is destroyed after. */
  flash(rect, peak = 0.45) {
    if (prefersReducedMotion()) {
      rect.destroy();
      return;
    }
    rect.setAlpha(peak);
    this.scene.tweens.add({
      targets: rect,
      alpha: 0,
      duration: 240,
      onComplete: () => rect.destroy(),
    });
  }

  burst(x, y, { count = 10, tint = 0xffffff, kind = 'sparks' } = {}) {
    const emitter = kind === 'puffs' ? this.puffs : this.sparks;
    emitter.setParticleTint(tint);
    emitter.explode(count, x, y);
  }

  /**
   * Floating text from a small pool. A Phaser Text is its own canvas texture,
   * so creating one per damage number meant a texture upload on every hit.
   */
  popText(x, y, text, color = COLORS.gold) {
    let label = this._textPool.find((t) => !t.active);
    if (!label) {
      label = this.scene.add.text(0, 0, '', textStyle(13, color, { weight: 900, stroke: 4 }))
        .setOrigin(0.5)
        .setDepth(DEPTH.FLOAT_TEXT);
      this._textPool.push(label);
    }
    this.scene.tweens.killTweensOf(label);
    const jitter = (Math.random() - 0.5) * 14; // stacked hits don't overlap exactly
    label.setActive(true).setVisible(true)
      .setText(text).setColor(color)
      .setPosition(x + jitter, y).setAlpha(1).setScale(0.6);
    this.scene.tweens.add({ targets: label, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: label,
      y: y - 38,
      alpha: 0,
      delay: 250,
      duration: 850,
      ease: 'Cubic.easeIn',
      onComplete: () => label.setActive(false).setVisible(false),
    });
  }
}

/** Tiny generated textures for particles and bubbles (no asset files needed). */
function makeFxTextures(scene) {
  const { textures, make } = scene;
  if (!textures.exists('fx_dot')) {
    const g = make.graphics({ add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('fx_dot', 8, 8);
    g.destroy();
  }
  if (!textures.exists('fx_bubble')) {
    const g = make.graphics({ add: false });
    g.lineStyle(1.5, 0xffffff, 0.9).strokeCircle(6, 6, 5);
    g.fillStyle(0xffffff, 0.8).fillCircle(4, 4, 1.5);
    g.generateTexture('fx_bubble', 12, 12);
    g.destroy();
  }
}
