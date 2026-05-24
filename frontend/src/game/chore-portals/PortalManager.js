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

      // Glow tint cycling
      this.scene.tweens.add({
        targets: portal,
        alpha: 0.7,
        duration: 800,
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
    // Visually tint portal to show restoration progress
    const child = this.portals.getChildren().find(
      (p) => p.zoneData.id === zoneId
    );
    if (!child) return;
    const tints = [0xffffff, 0xaaffaa, 0x44ff44, 0x00cc00];
    child.setTint(tints[Math.min(level, 3)]);
  }
}
