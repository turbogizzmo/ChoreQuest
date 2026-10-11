// Screen/view sizing for Adventure Mode.
//
// The canvas is rendered at device resolution (CSS size × devicePixelRatio) so
// text and HUD stay sharp on phones/retina screens, and it fills the whole
// container (no letterboxing). Two cameras do the drawing:
//
//   main camera — the world, zoomed by worldZoom × dpr
//   ui camera   — HUD/overlays (anything with scrollFactor 0), zoomed by dpr
//
// UI code lays itself out in CSS pixels via uiSize(scene); it never needs to
// know about dpr. A postupdate sweep routes each top-level game object to the
// right camera based on its scrollFactor, so existing setScrollFactor(0) calls
// keep working unchanged.

import { TILE_SIZE } from '../data/WorldData.js';

// Roughly how much of the world we want visible on a desktop screen.
const TARGET_TILES_W = 24;
const TARGET_TILES_H = 15;
const MAX_WORLD_ZOOM = 3;

/**
 * Compute the canvas size and zoom levels for a container of cssW × cssH.
 * Sprites are drawn with 2 texture px per design pixel, so we keep
 * worldZoom × dpr a multiple of 0.5 — every design pixel then covers a whole
 * number of device pixels and the pixel art stays even.
 */
export function computeView(cssW, cssH, devicePixelRatio = 1) {
  const dpr = Math.min(2, Math.max(1, Math.round(devicePixelRatio || 1)));
  const fit = Math.min(cssW / (TARGET_TILES_W * TILE_SIZE), cssH / (TARGET_TILES_H * TILE_SIZE));
  const step = 0.5 / dpr;
  const worldZoom = Math.min(MAX_WORLD_ZOOM, Math.max(1, Math.floor(fit / step) * step));
  return {
    dpr,
    worldZoom,
    cssW: Math.max(1, Math.floor(cssW)),
    cssH: Math.max(1, Math.floor(cssH)),
    width: Math.max(1, Math.floor(cssW)) * dpr,
    height: Math.max(1, Math.floor(cssH)) * dpr,
    // Text is rasterised once; give it enough pixels for the most-zoomed camera.
    textResolution: Math.ceil(worldZoom * dpr),
  };
}

export function getView(scene) {
  return scene.sys.game.registry.get('view') ?? computeView(scene.scale.width, scene.scale.height, 1);
}

/** HUD/overlay layout size in CSS pixels. */
export function uiSize(scene) {
  const v = getView(scene);
  return { w: v.cssW, h: v.cssH };
}

/** Convert a pointer's canvas coordinates to UI (CSS-pixel) coordinates. */
export function pointerToUi(scene, pointer) {
  const { dpr } = getView(scene);
  return { x: pointer.x / dpr, y: pointer.y / dpr };
}

/**
 * Configure the main camera zoom and add the UI camera. Call at the very top
 * of a scene's create().
 */
export function setupCameras(scene) {
  const view = getView(scene);
  const main = scene.cameras.main;
  main.setZoom(view.worldZoom * view.dpr);
  main.setRoundPixels(true);

  const ui = scene.cameras.add(0, 0, view.width, view.height, false, 'ui');
  ui.setOrigin(0, 0).setZoom(view.dpr).setScroll(0, 0).setRoundPixels(true);
  scene.uiCamera = ui;

  const route = () => {
    const list = scene.children.list;
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const isUi = obj.scrollFactorX === 0 && obj.scrollFactorY === 0;
      const filter = isUi ? main.id : ui.id;
      if (obj.cameraFilter !== filter) obj.cameraFilter = filter;
    }
  };
  // Route once now (objects created before this call) and before every render.
  route();
  scene.events.on('postupdate', route);
  scene.events.once('shutdown', () => scene.events.off('postupdate', route));
  return { main, ui, route };
}
