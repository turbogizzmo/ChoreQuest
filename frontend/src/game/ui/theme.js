// Shared look for in-game text and panels, so the HUD, nameplates, tutorial
// and overlays read as one design (and match the React shell around the
// canvas, which uses Inter).

export const UI_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Text is rasterised once per object; view.js sets this from the zoom so text
// stays crisp under the world camera's zoom and on high-DPI screens.
let textResolution = 2;
export function setTextResolution(n) {
  textResolution = Math.max(1, Math.min(6, Math.ceil(n)));
}

export const COLORS = {
  ink:       '#0b0e16',   // text stroke / darkest
  panel:     0x0f1420,    // HUD panel fill
  panelEdge: 0xffffff,    // used at low alpha for 1px borders
  text:      '#f4f1e8',
  muted:     '#9aa3b2',
  gold:      '#ffd45c',
  goldHex:   0xffd45c,
  green:     '#7ee081',
  greenHex:  0x5fd068,
  red:       '#ff6b6b',
  redHex:    0xe5484d,
  sky:       '#8fd3ff',
  orange:    '#ffa24c',
};

/**
 * Phaser text style.
 *   size    — CSS px (keep ≥ 11 for anything a kid needs to read)
 *   weight  — CSS font weight
 *   stroke  — outline width; defaults scale with size for legibility on any tile
 */
export function textStyle(size, color = COLORS.text, opts = {}) {
  const {
    weight = 700,
    stroke = Math.max(2, Math.round(size / 4)),
    strokeColor = COLORS.ink,
    align = 'center',
    ...rest
  } = opts;
  return {
    fontFamily: UI_FONT,
    fontSize: `${size}px`,
    fontStyle: String(weight),
    color,
    stroke: stroke > 0 ? strokeColor : undefined,
    strokeThickness: stroke,
    align,
    resolution: textResolution,
    ...rest,
  };
}

/** Rounded translucent HUD panel drawn into a Graphics object. */
export function drawPanel(g, x, y, w, h, { radius = 10, alpha = 0.72, fill = COLORS.panel } = {}) {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, COLORS.panelEdge, 0.12);
  g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
  return g;
}

/** Wait (briefly) for the UI font so the first frames don't render in a fallback face. */
export function loadUiFont() {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const timeout = new Promise((r) => setTimeout(r, 1500));
  const loads = Promise.all([
    document.fonts.load(`700 12px Inter`),
    document.fonts.load(`800 12px Inter`),
    document.fonts.load(`500 12px Inter`),
  ]).catch(() => {});
  return Promise.race([loads, timeout]);
}
