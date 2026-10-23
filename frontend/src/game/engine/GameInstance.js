// Creates and destroys the Phaser game instance.
// Called from the React AdventureMode page component.

import Phaser from 'phaser';
import { BootScene }  from './BootScene.js';
import { WorldScene } from './WorldScene.js';
import { computeView } from './view.js';
import { setTextResolution } from '../ui/theme.js';

// Height of the React header bar above the canvas (desktop only). Single
// source of truth — AdventureMode renders the header at this height.
export const ADVENTURE_HEADER_H = 44;

export function createGame(containerId, options = {}) {
  const { userId, userName, avatarConfig = null, isKid = false, headerH = ADVENTURE_HEADER_H, onExit, onComplete } = options;

  const container = document.getElementById(containerId);
  const availW = container ? container.clientWidth  : window.innerWidth;
  const availH = container ? container.clientHeight : (window.innerHeight - headerH);

  // Fill the container at device resolution; see view.js for the zoom rules.
  const view = computeView(availW, availH, window.devicePixelRatio);
  setTextResolution(view.textResolution);

  const config = {
    type: Phaser.AUTO,
    parent: containerId,
    width:  view.width,
    height: view.height,
    backgroundColor: '#0d1b2a',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    physics: {
      default: 'arcade',
      // Step physics with the real frame delta so sprites move every rendered
      // frame on 90/120 Hz screens (a fixed 60 Hz step judders there). Safe
      // here: the fastest body moves ~3 px per 60 Hz step against 32 px
      // tiles, so a variable step can't tunnel through walls or portals.
      arcade: { gravity: { y: 0 }, debug: false, fixedStep: false },
    },
    scene: [BootScene, WorldScene],
    scale: {
      // Canvas is view.width × view.height device pixels; FIT shows it at the
      // container's CSS size (exactly 1/dpr), so nothing is stretched.
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width:  view.width,
      height: view.height,
    },
    input: { touch: true },
    callbacks: {
      preBoot: (g) => g.registry.set('view', view),
    },
  };

  const game = new Phaser.Game(config);
  if (typeof window !== 'undefined' && import.meta.env.DEV) window.__CHOREQUEST_ACTIVE_GAME = game;

  game.events.once('ready', () => {
    game.scene.start('BootScene', { userId, userName, avatarConfig, isKid, onExit, onComplete });
  });

  // Phaser caches where the canvas sits on the page to map clicks/taps. The
  // React shell can shift it after boot (header, splash, mobile chrome), which
  // left on-canvas buttons unclickable — re-measure whenever the container moves.
  if (container && typeof ResizeObserver !== 'undefined') {
    const remeasure = () => { if (!game.isDestroyed) game.scale.updateBounds(); };
    const ro = new ResizeObserver(remeasure);
    ro.observe(container);
    window.addEventListener('scroll', remeasure, true);
    const timer = setTimeout(remeasure, 500);
    game.events.once('destroy', () => {
      ro.disconnect();
      window.removeEventListener('scroll', remeasure, true);
      clearTimeout(timer);
    });
  }

  return game;
}

export function destroyGame(game) {
  if (game && !game.pendingDestroy) {
    // Phaser only finishes destroying on its next frame (and only then closes
    // the AudioContext). Silence audio now so nothing plays past the exit even
    // if that frame is delayed or never comes (page hidden, app backgrounded).
    try {
      game.scene?.getScene?.('WorldScene')?.stopAudio?.();
      game.sound?.context?.suspend?.();
    } catch (_) { /* game never finished booting */ }
    game.destroy(true);
  }
  if (typeof window !== 'undefined' && import.meta.env.DEV && window.__CHOREQUEST_ACTIVE_GAME === game) {
    window.__CHOREQUEST_ACTIVE_GAME = null;
  }
}
