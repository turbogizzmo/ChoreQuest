// Creates portal sprites on the map and handles zone entry detection.
// Emits 'portalEnter' scene event when player walks into a portal zone.

import { PORTAL_ZONES, TILE_SIZE } from '../data/WorldData.js';

export class PortalManager {
  constructor(scene) {
    this.scene   = scene;
    this.portals = scene.physics.add.staticGroup();
    this._createPortals();
  }

  _createPortals() {
    PORTAL_ZONES.forEach((zone) => {
      const px = zone.x * TILE_SIZE + TILE_SIZE / 2;
      const py = zone.y * TILE_SIZE + TILE_SIZE / 2;

      const portal = this.portals.create(px, py, 'portal');
      portal.zoneData  = zone;
      portal.setDepth(8);
      portal.body.setSize(TILE_SIZE * 1.5, TILE_SIZE * 1.5);

      // Start at restore level 0 (dim grey, slow pulse)
      // setRestoreLevel() updates this when save data is loaded.
      portal.setTint(0x888888);
      this.scene.tweens.add({
        targets: portal,
        alpha: 0.3,
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Label with dark background for readability
      const label = this.scene.add.text(px, py - 30, zone.label, {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#fcd860',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      }).setOrigin(0.5).setDepth(15);

      const labelBg = this.scene.add.rectangle(
        px, py - 30, label.width + 14, 18, 0x000000, 0.7,
      ).setOrigin(0.5).setDepth(14);

      const hint = this.scene.add.text(px, py - 14, 'walk in to enter', {
        fontSize: '8px',
        fontFamily: 'monospace',
        color: '#aaffaa',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      }).setOrigin(0.5).setDepth(15);

      portal.label    = label;
      portal.labelBg  = labelBg;
      portal.hintText = hint;
    });

    // Animate portal frames
    if (!this.scene.anims.exists('portal_spin')) {
      this.scene.anims.create({
        key: 'portal_spin',
        frames: this.scene.anims.generateFrameNumbers('portal', { start: 0, end: 3 }),
        frameRate: 4,
        repeat: -1,
      });
    }
    this.portals.getChildren().forEach((p) => p.play('portal_spin'));
  }

  addOverlap(player) {
    this.scene.physics.add.overlap(player, this.portals, (_player, portal) => {
      this.scene.events.emit('portalEnter', portal.zoneData);
    });
  }

  setRestoreLevel(zoneId, level) {
    // Tint and scale portal to reflect restoration progress (0 = dim, 4 = fully restored)
    const child = this.portals.getChildren().find(
      (p) => p.zoneData.id === zoneId
    );
    if (!child) return;

    // Progressively brighter green tint
    const tints = [0x888888, 0xaaffaa, 0x44ff44, 0x00cc00, 0x00ff88];
    child.setTint(tints[Math.min(level, 4)]);

    // Stop any running alpha tween and replace with level-appropriate pulse speed
    this.scene.tweens.killTweensOf(child);
    const pulseDuration = level === 0 ? 1800 : level < 3 ? 1200 : 600; // faster = healthier
    const minAlpha      = level === 0 ? 0.3 : 0.55;
    this.scene.tweens.add({
      targets: child,
      alpha: minAlpha,
      duration: pulseDuration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Grow portal slightly as the zone restores (scale 1 → 1.4)
    const scale = 1 + level * 0.1;
    child.setScale(scale);
  }
}
