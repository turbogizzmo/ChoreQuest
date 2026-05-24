// BootScene: generates all sprites via canvas and passes userId + save data
// to the main WorldScene.

import Phaser from 'phaser';
import { generateAllSprites } from '../sprites/SpriteGenerator.js';
import { loadSave, defaultSave } from '../systems/SaveSystem.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  init(data) {
    this.userId    = data.userId ?? 'guest';
    this.userName  = data.userName ?? 'Hero';
    this.avatarConfig = data.avatarConfig ?? null;
    this.isKid     = data.isKid ?? false;
    this.onExit    = data.onExit ?? (() => {});
    this.onComplete = data.onComplete ?? (() => {});
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // Loading screen
    this.add.rectangle(0, 0, w, h, 0x121212).setOrigin(0);
    const title = this.add.text(w / 2, h / 2 - 24, 'ChoreQuest', {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#fcd860',
      stroke: '#000000',
      strokeThickness: 4,
      resolution: 2,
    }).setOrigin(0.5);

    const sub = this.add.text(w / 2, h / 2 + 8, 'Loading Adventure Mode...', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#bcbcbc',
      resolution: 2,
    }).setOrigin(0.5);

    // Generate all sprites (canvas-based, synchronous)
    const tileMap = generateAllSprites(this, { avatarConfig: this.avatarConfig });

    loadSave(this.userId).then((save) => {
      // Guard: game may have been destroyed by the time this resolves (React StrictMode double-invoke)
      if (!this.sys?.game || this.sys.game.isDestroyed) return;
      const gameData = save ?? defaultSave(this.userId);
      this.scene.start('WorldScene', {
        userId:    this.userId,
        userName:  this.userName,
        isKid:     this.isKid,
        gameData,
        tileMap,
        onExit:    this.onExit,
        onComplete: this.onComplete,
      });
    });
  }
}
