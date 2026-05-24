// Creates and destroys the Phaser game instance.
// Called from the React AdventureMode page component.

import Phaser from 'phaser';
import { BootScene }  from './BootScene.js';
import { WorldScene } from './WorldScene.js';

export function createGame(containerId, options = {}) {
  const { userId, userName, isKid = false, headerH = 34, onExit, onComplete } = options;

  const container = document.getElementById(containerId);
  const availW = container ? container.clientWidth  : window.innerWidth;
  const availH = container ? container.clientHeight : (window.innerHeight - headerH);

  const gameW = Math.min(availW, 800);
  const gameH = Math.min(availH, 600);

  const config = {
    type: Phaser.AUTO,
    parent: containerId,
    width:  gameW,
    height: gameH,
    backgroundColor: '#121212',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 0 }, debug: false },
    },
    scene: [BootScene, WorldScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width:  gameW,
      height: gameH,
    },
    input: { touch: true },
  };

  const game = new Phaser.Game(config);

  game.events.once('ready', () => {
    game.scene.start('BootScene', { userId, userName, isKid, onExit, onComplete });
  });

  return game;
}

export function destroyGame(game) {
  if (game && !game.isDestroyed) {
    game.destroy(true);
  }
}
