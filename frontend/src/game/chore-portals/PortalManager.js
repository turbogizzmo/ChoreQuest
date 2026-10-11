// District doorways: each portal is the glowing entrance of its building.
// An invisible physics body on the tile in front of the door detects entry and
// emits 'portalEnter'; the visible part is a pulsing light pool at the door, a
// nameplate above the roof and a hint that appears when the hero is close.

import Phaser from 'phaser';
import { PORTAL_ZONES, BUILDINGS, TILE_SIZE } from '../data/WorldData.js';
import { DEPTH } from '../engine/depth.js';
import { BUILDING_SPRITE } from '../sprites/WorldArt.js';
import { textStyle, COLORS } from '../ui/theme.js';

const HINT_RANGE_PX = TILE_SIZE * 3;
// Door glow brightness per restore level (0 = dim, 4 = fully restored)
const GLOW_ALPHA = [0.75, 0.82, 0.9, 0.95, 1];

export class PortalManager {
  constructor(scene) {
    this.scene   = scene;
    this.portals = scene.physics.add.staticGroup();
    this._createPortals();
  }

  _createPortals() {
    const scene = this.scene;

    if (!scene.anims.exists('door_glow')) {
      scene.anims.create({
        key: 'door_glow',
        frames: scene.anims.generateFrameNumbers('door_glow', { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }

    PORTAL_ZONES.forEach((zone) => {
      const px = zone.x * TILE_SIZE + TILE_SIZE / 2;
      const py = zone.y * TILE_SIZE + TILE_SIZE / 2;

      // Invisible trigger on the doorstep tile
      const portal = this.portals.create(px, py, 'door_glow', 0);
      portal.setVisible(false);
      portal.body.setSize(TILE_SIZE * 1.5, TILE_SIZE * 1.5);
      portal.zoneData = zone;

      // Light pool spilling out of the door
      const glow = scene.add.sprite(px, zone.y * TILE_SIZE + 6, 'door_glow', 0)
        .setTint(zone.color ?? 0xffffff)
        .setDepth(DEPTH.NIGHT + 1)   // doorways keep glowing after dark
        .setScale(zone.isRewardShop ? 1.9 : 1.35, 1.4)
        .setBlendMode(Phaser.BlendModes.ADD);
      glow.play('door_glow');
      portal.glow = glow;

      // Nameplate floating above the roof
      const building = BUILDINGS.find((b) => b.id === zone.id);
      const sprite = zone.isRewardShop ? BUILDING_SPRITE.castle : BUILDING_SPRITE.house;
      const roofTop = building
        ? (building.row + building.h) * TILE_SIZE - sprite.h * 2
        : py - TILE_SIZE * 2;
      portal.nameplate = this._makeNameplate(px, roofTop - 6, zone);

      // "Walk in" hint tucked under the nameplate (never covered by the hero),
      // only shown when the hero is near the door
      const hint = scene.add.text(px, roofTop, 'Walk into the doorway ↓',
        textStyle(11, COLORS.gold, { weight: 800, stroke: 3 }))
        .setOrigin(0.5, 0).setDepth(DEPTH.LABEL).setAlpha(0);
      portal.hintText = hint;
      portal._hintShown = false;

      this.setRestoreLevel(zone.id, 0, portal);
    });
  }

  _makeNameplate(x, y, zone) {
    const scene = this.scene;
    const label = scene.add.text(0, 0, zone.label, textStyle(13, COLORS.text, { weight: 800, stroke: 0 }))
      .setOrigin(0, 0.5);
    const dotR = 4;
    const padX = 10;
    const w = Math.ceil(label.width) + padX * 2 + dotR * 2 + 6;
    const h = 24;
    const bg = scene.add.graphics();
    bg.fillStyle(0x0f1420, 0.82);
    bg.fillRoundedRect(-w / 2, -h, w, h, h / 2);
    bg.lineStyle(1, zone.color ?? 0xffffff, 0.8);
    bg.strokeRoundedRect(-w / 2 + 0.5, -h + 0.5, w - 1, h - 1, h / 2);
    bg.fillStyle(zone.color ?? 0xffffff, 1);
    bg.fillCircle(-w / 2 + padX + dotR, -h / 2, dotR);
    label.setPosition(-w / 2 + padX + dotR * 2 + 6, -h / 2);
    return scene.add.container(x, y, [bg, label]).setDepth(DEPTH.LABEL);
  }

  addOverlap(player) {
    this.scene.physics.add.overlap(player, this.portals, (_player, portal) => {
      this.scene.events.emit('portalEnter', portal.zoneData);
    });
  }

  /** Show door hints when the hero is nearby. Call from the scene update. */
  update(player) {
    if (!player) return;
    this.portals.getChildren().forEach((portal) => {
      const dx = player.x - portal.x;
      const dy = player.y - portal.y;
      const near = dx * dx + dy * dy < HINT_RANGE_PX * HINT_RANGE_PX;
      if (near === portal._hintShown) return;
      portal._hintShown = near;
      this.scene.tweens.killTweensOf(portal.hintText);
      this.scene.tweens.add({ targets: portal.hintText, alpha: near ? 1 : 0, duration: 180 });
    });
  }

  setRestoreLevel(zoneId, level, child = null) {
    child = child ?? this.portals.getChildren().find((p) => p.zoneData.id === zoneId);
    if (!child?.glow) return;
    const lvl = Math.max(0, Math.min(4, level));
    const glow = child.glow;
    const base = GLOW_ALPHA[lvl];

    // Healthier districts glow brighter and pulse faster
    this.scene.tweens.killTweensOf(glow);
    glow.setAlpha(base);
    this.scene.tweens.add({
      targets: glow,
      alpha: base * 0.6,
      duration: lvl === 0 ? 1600 : lvl < 3 ? 1100 : 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}
