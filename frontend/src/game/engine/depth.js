// World draw order. HUD/overlays are drawn by the separate UI camera
// (view.js), so their depths only matter relative to each other.

export const DEPTH = {
  GROUND:     0,
  DECAL:      2,   // door glow, ground marks
  SHADOW:     3,
  ENTITY:     10,  // + y/100 — see ySort()
  VFX:        30,  // attack swings, coin pickups
  NIGHT:      40,  // day/night tint covers the whole world…
  VFX_GLOW:   42,  // …except emissive effects (slashes, sparks), which stay bright at night
  LABEL:      45,  // …but nameplates, HP bars and speech stay readable
  BUBBLE:     46,
  FLOAT_TEXT: 60,
};

/**
 * Depth for anything standing in the world: things lower on screen draw in
 * front, so the hero can walk behind trees and buildings. y is the object's
 * feet/base in world px (0–1280 → 10–22.8, always below VFX).
 */
export function ySort(y) {
  return DEPTH.ENTITY + y / 100;
}
