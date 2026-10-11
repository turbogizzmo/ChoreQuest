// Procedural art for the Home Realm: painted ground, scenery props and the
// district buildings. Everything is drawn at 2 texture px per design pixel,
// the same density as the characters, so the world reads as one pixel-art set.

import { TILE, TILE_SIZE, MAP_COLS, MAP_ROWS, tileHash } from '../data/WorldData.js';

const P = 2; // texture px per design pixel

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  grass:      [95, 181, 72],
  grassLight: [107, 192, 82],
  grassDark:  [84, 166, 64],
  grassBlade: [70, 148, 56],
  path:       [216, 191, 138],
  pathLight:  [230, 210, 163],
  pathDark:   [194, 164, 110],
  pebble:     [168, 139, 90],
  stone:      [190, 183, 170],
  stoneLight: [208, 202, 190],
  stoneDark:  [160, 152, 139],
  mortar:     [136, 128, 116],
  sand:       [236, 217, 160],
  sandLight:  [245, 232, 191],
  sandDark:   [217, 194, 131],
  water:      [52, 112, 214],
  waterDeep:  [40, 90, 190],
  waterShallow: [84, 160, 226],
  waterLight: [120, 184, 240],
  foam:       [232, 244, 255],
};
const FLOWER_COLORS = [[255, 107, 139], [255, 210, 63], [255, 255, 255], [178, 141, 255], [255, 159, 67]];

const hex = ([r, g, b]) => `rgb(${r},${g},${b})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function uploadCanvas(scene, key, c) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, c.width, c.height);
  tex.context.drawImage(c, 0, 0);
  tex.refresh();
  return tex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ground
// ═══════════════════════════════════════════════════════════════════════════════

const GROUND_OF = {
  [TILE.PATH]: 'path',
  [TILE.STONE]: 'stone',
  [TILE.SAND]: 'sand',
  [TILE.WATER]: 'water',
};
const groundType = (t) => GROUND_OF[t] ?? 'grass';

/** Paint the whole world's ground into one texture (`ground`). */
export function paintGround(scene, grid) {
  const W = MAP_COLS * TILE_SIZE;
  const H = MAP_ROWS * TILE_SIZE;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const buf = new Uint32Array(img.data.buffer);
  const pack = ([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA

  const D = TILE_SIZE / P; // design px per tile (16)
  const DW = MAP_COLS * D;
  const put = (dx, dy, col) => {
    const v = pack(col);
    const x0 = dx * P;
    const y0 = dy * P;
    for (let yy = 0; yy < P; yy++) {
      const row = (y0 + yy) * W + x0;
      for (let xx = 0; xx < P; xx++) buf[row + xx] = v;
    }
  };
  // Under a building, continue the paving it stands on (the castle courtyard
  // shows between its towers); otherwise it's grass.
  const nextToStone = (r, c2) => [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
    .some(([dr, dc]) => grid[r + dr]?.[c2 + dc] === TILE.STONE);
  const typeAt = (r, c2) => {
    if (r < 0 || c2 < 0 || r >= MAP_ROWS || c2 >= MAP_COLS) return 'water';
    const t = grid[r][c2];
    if (t === TILE.WALL) return nextToStone(r, c2) || grid[r + 1]?.[c2] === TILE.WALL && nextToStone(r + 1, c2) ? 'stone' : 'grass';
    return groundType(t);
  };
  const rnd = (x, y, s) => tileHash(y, x, s);

  // Distance (in tiles, capped) to the nearest land — water gets deeper offshore
  const landDist = (r, c2) => {
    for (let d = 1; d <= 2; d++) {
      for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
        if (typeAt(r + dr, c2 + dc) !== 'water') return d;
      }
    }
    return 3;
  };

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c2 = 0; c2 < MAP_COLS; c2++) {
      const type = typeAt(r, c2);
      const dist = type === 'water' ? landDist(r, c2) : 0;
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
          const gx = c2 * D + x;
          const gy = r * D + y;
          const n = rnd(gx, gy, 11);
          let col;
          switch (type) {
            case 'path':
              col = n < 0.08 ? C.pathDark : n < 0.16 ? C.pathLight : C.path;
              if (n > 0.985) col = C.pebble;
              break;
            case 'stone': {
              // Staggered flagstones, 8×6 design px
              const row = Math.floor(gy / 6);
              const off = (row % 2) * 4;
              const isMortar = gy % 6 === 0 || (gx + off) % 8 === 0;
              col = isMortar ? C.mortar : (n < 0.12 ? C.stoneDark : n < 0.24 ? C.stoneLight : C.stone);
              if (!isMortar && (gy % 6 === 1 || (gx + off) % 8 === 1)) col = mix(col, C.stoneLight, 0.5);
              break;
            }
            case 'sand':
              col = n < 0.1 ? C.sandDark : n < 0.2 ? C.sandLight : C.sand;
              break;
            case 'water': {
              const base = dist >= 3 ? C.waterDeep : dist === 2 ? C.water : C.waterShallow;
              col = base;
              // Short horizontal wave glints
              const w = rnd(Math.floor(gx / 5), gy, 12);
              if (w > 0.94 && gy % 3 === 0) col = C.waterLight;
              break;
            }
            default: {
              // Grass with soft mottling and little blades
              const m = rnd(Math.floor(gx / 3), Math.floor(gy / 3), 13);
              col = m < 0.18 ? C.grassDark : m > 0.86 ? C.grassLight : C.grass;
              if (n > 0.965) col = C.grassBlade;
              else if (n > 0.95 && y > 0) put(gx, gy - 1, C.grassBlade);
            }
          }
          put(gx, gy, col);
        }
      }

      // ── Edges: grass grows over roads/sand; surf where water meets land ─
      const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      if (type === 'path' || type === 'sand' || type === 'stone') {
        sides.forEach(([dr, dc]) => {
          if (typeAt(r + dr, c2 + dc) !== 'grass') return;
          for (let i = 0; i < D; i++) {
            const depth = 1 + Math.floor(rnd(c2 * D + i * (dc === 0 ? 1 : 0), r * D + i * (dr === 0 ? 1 : 0), 14 + dr * 3 + dc) * (type === 'stone' ? 1.6 : 2.6));
            for (let k = 0; k < depth; k++) {
              const x = dc === 0 ? i : dc < 0 ? k : D - 1 - k;
              const y = dr === 0 ? i : dr < 0 ? k : D - 1 - k;
              put(c2 * D + x, r * D + y, k === depth - 1 ? C.grassDark : C.grass);
            }
          }
        });
      }
      if (type === 'water') {
        sides.forEach(([dr, dc]) => {
          const t2 = typeAt(r + dr, c2 + dc);
          if (t2 === 'water') return;
          for (let i = 0; i < D; i++) {
            const wob = rnd(c2 * D + i, r * D + i, 15 + dr * 3 + dc) < 0.5 ? 1 : 2;
            for (let k = 0; k <= wob; k++) {
              const x = dc === 0 ? i : dc < 0 ? k : D - 1 - k;
              const y = dr === 0 ? i : dr < 0 ? k : D - 1 - k;
              put(c2 * D + x, r * D + y, k === 0 ? C.foam : mix(C.foam, C.waterShallow, 0.55));
            }
          }
        });
      }

      // ── Flower clusters ─────────────────────────────────────────────
      if (grid[r][c2] === TILE.FLOWER) {
        const count = 3 + Math.floor(tileHash(r, c2, 16) * 3);
        for (let i = 0; i < count; i++) {
          const fx = c2 * D + 2 + Math.floor(tileHash(r, c2, 20 + i) * (D - 5));
          const fy = r * D + 2 + Math.floor(tileHash(r, c2, 40 + i) * (D - 5));
          const fc = FLOWER_COLORS[Math.floor(tileHash(r, c2, 60 + i) * FLOWER_COLORS.length)];
          put(fx, fy + 1, C.grassBlade);           // stem
          put(fx - 1, fy, fc); put(fx + 1, fy, fc); put(fx, fy - 1, fc); put(fx, fy + 1, fc);
          put(fx, fy, [255, 236, 140]);            // centre
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  uploadCanvas(scene, 'ground', c);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Small drawing kit (design-pixel coordinates)
// ═══════════════════════════════════════════════════════════════════════════════

function kit(c) {
  const ctx = c.getContext('2d');
  const px = (x, y, w, h, col) => {
    if (!col) return;
    ctx.fillStyle = typeof col === 'string' ? col : hex(col);
    ctx.fillRect(Math.round(x) * P, Math.round(y) * P, Math.round(w) * P, Math.round(h) * P);
  };
  // Filled disc built from rows (crisp pixel circle)
  const disc = (cx, cy, rad, colFn) => {
    for (let y = -rad; y <= rad; y++) {
      const half = Math.floor(Math.sqrt(rad * rad - y * y) + 0.35);
      for (let x = -half; x <= half; x++) {
        const col = colFn(x, y);
        if (col) px(cx + x, cy + y, 1, 1, col);
      }
    }
  };
  const grid = (ox, oy, rows, pal) => rows.forEach((row, y) => [...row].forEach((ch, x) => px(ox + x, oy + y, 1, 1, pal[ch])));
  return { ctx, px, disc, grid };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Props: trees, bushes, rocks, shadows, door glow
// ═══════════════════════════════════════════════════════════════════════════════

const TREE_PALETTES = [
  { dark: [38, 104, 50], base: [52, 138, 62], light: [86, 176, 82], hi: [134, 206, 108] },
  { dark: [44, 112, 44], base: [66, 150, 58], light: [102, 186, 76], hi: [150, 214, 98] },
  { dark: [34, 96, 64], base: [46, 128, 78], light: [74, 164, 96], hi: [122, 200, 124] },
];
const TRUNK = { dark: [92, 58, 34], base: [124, 82, 48], light: [156, 108, 66] };

function drawRoundTree(k, pal) {
  // Sprite: 26 × 30 design px; trunk base at (13, 29)
  const { px, disc } = k;
  px(11, 20, 4, 9, TRUNK.base);
  px(11, 20, 1, 9, TRUNK.light);
  px(14, 20, 1, 9, TRUNK.dark);
  px(10, 28, 6, 1, TRUNK.dark);
  // Canopy: three overlapping blobs, lit from the upper left
  const blobs = [[8, 13, 7], [18, 13, 7], [13, 9, 8]];
  const inside = (x, y, skip) => blobs.some(([bx, by, br], i) => i !== skip && (x - bx) ** 2 + (y - by) ** 2 <= br * br);
  blobs.forEach(([bx, by, br]) => disc(bx, by, br + 1, () => pal.dark));
  blobs.forEach(([bx, by, br], i) => disc(bx, by, br, (x, y) => {
    const lx = x + by - 13; // light falloff
    const shade = (x + y) / br;
    if (shade > 0.7 && !inside(bx + x + 1, by + y + 1, i)) return pal.dark;
    if (shade < -0.55) return pal.light;
    if (lx < -6 && y < 0) return pal.light;
    return pal.base;
  }));
  // Highlights / leaf clumps
  [[9, 9], [13, 5], [16, 8], [6, 13], [11, 12]].forEach(([x, y]) => { px(x, y, 2, 1, pal.hi); px(x, y + 1, 1, 1, pal.light); });
  [[17, 16], [10, 17], [20, 12]].forEach(([x, y]) => px(x, y, 2, 1, pal.dark));
}

function drawPine(k) {
  const { px } = k;
  const dark = [28, 92, 62], base = [40, 122, 78], light = [70, 160, 96];
  px(11, 24, 4, 6, TRUNK.base);
  px(11, 24, 1, 6, TRUNK.light);
  const tiers = [[2, 9, 7], [8, 11, 9], [14, 13, 11]]; // [topY, half, height]
  tiers.forEach(([top, half, height]) => {
    for (let y = 0; y < height; y++) {
      const w = Math.max(1, Math.round((y + 1) / height * half));
      px(13 - w, top + y, w * 2, 1, base);
      px(13 - w, top + y, 1, 1, dark);
      px(13 + w - 1, top + y, 1, 1, dark);
      if (y > 1) px(13 - w + 1, top + y, Math.max(1, Math.floor(w / 2)), 1, light);
    }
    px(13 - half, top + height - 1, half * 2, 1, dark);
  });
  px(12, 1, 2, 2, light);
}

function drawBush(k, berries) {
  const { px, disc } = k;
  const dark = [44, 116, 52], base = [62, 150, 64], light = [98, 186, 84];
  const blobs = [[5, 7, 4], [11, 7, 4], [8, 5, 4]];
  blobs.forEach(([x, y, r]) => disc(x, y, r + 1, () => dark));
  blobs.forEach(([x, y, r]) => disc(x, y, r, (dx, dy) => (dx + dy < -3 ? light : dx + dy > 3 ? dark : base)));
  if (berries) [[4, 6], [9, 4], [12, 8], [7, 9]].forEach(([x, y]) => { px(x, y, 1, 1, [230, 60, 80]); });
  else [[5, 4], [9, 3]].forEach(([x, y]) => px(x, y, 2, 1, [134, 206, 108]));
}

function drawRock(k) {
  const { px, grid } = k;
  grid(0, 0, [
    '...oooooo...',
    '..oLLLLbbo..',
    '.oLLlbbbbbo.',
    'oLlbbbbbbbdo',
    'obbbbbbbbddo',
    'obbbbbbbdddo',
    '.oddddddddo.',
    '..oooooooo..',
  ], { o: [74, 72, 76], L: [214, 210, 202], l: [190, 186, 180], b: [160, 156, 152], d: [124, 120, 118] });
  px(4, 4, 1, 1, [110, 150, 90]); // a bit of moss
  px(5, 3, 1, 1, [110, 150, 90]);
}

function shadowTexture(scene) {
  const w = 24, h = 8;
  const c = canvas(w * P, h * P);
  const { disc } = kit(c);
  // Ellipse drawn as a stretched disc
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.scale(1, h / w);
  disc(w / 2, w / 2, w / 2 - 1, () => 'rgba(20,30,20,0.32)');
  ctx.restore();
  uploadCanvas(scene, 'shadow', c);
}

function doorGlowTexture(scene) {
  // 4 frames of a soft light pool for portal doorways, tinted per zone at runtime
  const FW = 22, FH = 10, FRAMES = 4;
  const c = canvas(FW * P * FRAMES, FH * P);
  const { px } = kit(c);
  for (let f = 0; f < FRAMES; f++) {
    const ox = f * FW;
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const dx = (x - (FW - 1) / 2) / (FW / 2);
        const dy = (y - (FH - 1) / 2) / (FH / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const a = Math.max(0, 0.75 - d * 0.7);
        px(ox + x, y, 1, 1, `rgba(255,255,255,${a.toFixed(2)})`);
      }
    }
    // Rising sparkles, different per frame
    [[4, 7], [9, 3], [14, 6], [18, 4]].forEach(([sx, sy], i) => {
      const yy = (sy - f * 2 - i + 20) % FH;
      px(ox + sx, yy, 1, 1, 'rgba(255,255,255,0.95)');
    });
  }
  const tex = uploadCanvas(scene, 'door_glow', c);
  for (let i = 0; i < FRAMES; i++) tex.add(i, 0, i * FW * P, 0, FW * P, FH * P);
}

// Soft radial light (white; tinted per use) for window and door glows at night
function softGlowTexture(scene) {
  const R = 24;
  const c = canvas(R * 2, R * 2);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, R * 2, R * 2);
  uploadCanvas(scene, 'soft_glow', c);
}

export function generateProps(scene) {
  softGlowTexture(scene);
  TREE_PALETTES.forEach((pal, i) => {
    const c = canvas(26 * P, 30 * P);
    drawRoundTree(kit(c), pal);
    uploadCanvas(scene, `tree_${i}`, c);
  });
  {
    const c = canvas(26 * P, 30 * P);
    drawPine(kit(c));
    uploadCanvas(scene, 'tree_pine', c);
  }
  ['bush', 'bush_berry'].forEach((key, i) => {
    const c = canvas(16 * P, 12 * P);
    drawBush(kit(c), i === 1);
    uploadCanvas(scene, key, c);
  });
  {
    const c = canvas(12 * P, 8 * P);
    drawRock(kit(c));
    uploadCanvas(scene, 'rock', c);
  }
  shadowTexture(scene);
  doorGlowTexture(scene);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Buildings
// ═══════════════════════════════════════════════════════════════════════════════

const EMBLEMS = {
  // 8×7 icons for the door signs
  kitchen: ['..WWWW..', '.WWWWWW.', '.WWWWWW.', '..WWWW..', '..wwww..', '..wwww..', '........'],     // chef hat
  laundry: ['.BB..BB.', 'BBBBBBBB', '.BBBBBB.', '.BBBBBB.', '.BBBBBB.', '.BBBBBB.', '........'],     // shirt
  greenhouse: ['...GG...', '..GGGG..', '.GGgGGG.', 'GGGgGGGG', '...g....', '...g....', '..ddd...'], // sprout
  library: ['........', 'PPP.PPP.', 'PwwPwwP.', 'PwwPwwP.', 'PwwPwwP.', 'PPPPPPP.', '........'],    // open book
  castle: ['...Y....', '..YYY...', 'YYYYYYY.', '.YYYYY..', '..YYY...', '.YY.YY..', '........'],      // star
};
const EMBLEM_PAL = {
  W: [250, 250, 250], w: [210, 214, 222], B: [96, 150, 255], G: [96, 196, 92], g: [60, 140, 64],
  d: [120, 80, 50], P: [150, 110, 220], Y: [255, 214, 70],
};

const STYLES = {
  kitchen:    { roof: [204, 82, 64],  roofDark: [150, 54, 46],  roofLight: [232, 120, 92], wall: [244, 228, 196], wallDark: [214, 194, 158], trim: [124, 82, 48], chimney: true,  wallKind: 'plaster' },
  laundry:    { roof: [78, 126, 214], roofDark: [52, 88, 160],  roofLight: [118, 164, 238], wall: [206, 160, 108], wallDark: [170, 124, 80],  trim: [244, 236, 220], chimney: false, wallKind: 'planks' },
  greenhouse: { roof: [176, 228, 214], roofDark: [120, 182, 170], roofLight: [222, 248, 240], wall: [150, 214, 196], wallDark: [102, 168, 150], trim: [244, 248, 246], chimney: false, wallKind: 'glass' },
  library:    { roof: [128, 92, 196], roofDark: [88, 60, 150],  roofLight: [166, 132, 226], wall: [196, 176, 160], wallDark: [160, 140, 124], trim: [236, 226, 210], chimney: true,  wallKind: 'brick' },
};

function drawHouse(k, s, emblem) {
  const { px, grid } = k;
  const W = 48;
  // Chimney (behind roof)
  if (s.chimney) {
    px(34, 2, 6, 12, [150, 84, 66]);
    px(34, 2, 1, 12, [178, 108, 86]);
    px(33, 1, 8, 2, [96, 60, 50]);
  }
  // Roof: shingle rows getting darker toward the eave
  for (let y = 5; y <= 28; y++) {
    const inset = y < 8 ? 8 - y : 0;
    const t = (y - 5) / 23;
    const rowCol = mix(s.roofLight, s.roof, Math.min(1, t * 1.6));
    px(1 + inset, y, W - 2 - inset * 2, 1, rowCol);
    if ((y - 5) % 4 === 3) px(1 + inset, y, W - 2 - inset * 2, 1, mix(rowCol, s.roofDark, 0.55));
    else {
      const off = Math.floor((y - 5) / 4) % 2 ? 3 : 0;
      for (let x = 1 + inset + off; x < W - 1 - inset; x += 6) px(x, y, 1, 1, mix(rowCol, s.roofDark, 0.4));
    }
  }
  px(7, 3, W - 14, 3, s.roofLight);                   // ridge cap
  px(7, 3, W - 14, 1, mix(s.roofLight, [255, 255, 255], 0.35));
  px(0, 28, W, 2, s.roofDark);                        // eave
  px(1, 30, W - 2, 1, mix(s.roofDark, [0, 0, 0], 0.35));

  // Walls
  const wx = 3, wy = 31, ww = W - 6, wh = 30;
  px(wx, wy, ww, wh, s.wall);
  px(wx, wy, ww, 2, mix(s.wall, [0, 0, 0], 0.22));    // shadow under the eave
  if (s.wallKind === 'planks') {
    for (let y = wy + 4; y < wy + wh; y += 4) px(wx, y, ww, 1, s.wallDark);
  } else if (s.wallKind === 'brick') {
    for (let y = wy + 3; y < wy + wh; y += 3) {
      px(wx, y, ww, 1, s.wallDark);
      const off = Math.floor((y - wy) / 3) % 2 ? 3 : 0;
      for (let x = wx + off; x < wx + ww; x += 6) px(x, y - 2, 1, 2, s.wallDark);
    }
  } else if (s.wallKind === 'glass') {
    for (let x = wx; x < wx + ww; x += 7) px(x, wy, 1, wh, s.trim);
    px(wx, wy + 12, ww, 1, s.trim);
    // Plants visible through the glass
    [[6, 50], [12, 48], [35, 50], [41, 47]].forEach(([x, y]) => { px(x, y, 3, 2, [70, 160, 70]); px(x + 1, y - 2, 1, 2, [90, 190, 80]); });
  } else {
    // plaster: subtle speckle
    for (let i = 0; i < 18; i++) px(wx + ((i * 17) % ww), wy + 4 + ((i * 11) % (wh - 6)), 1, 1, s.wallDark);
  }
  px(wx, wy, 1, wh, mix(s.wall, [255, 255, 255], 0.3)); // lit left edge
  px(wx + ww - 1, wy, 1, wh, s.wallDark);               // shaded right edge
  px(2, 60, W - 4, 4, [128, 122, 114]);                 // stone foundation
  px(2, 60, W - 4, 1, [160, 154, 146]);

  // Windows with warm light and flower boxes
  [[7, 38], [32, 38]].forEach(([x, y]) => {
    px(x - 1, y - 1, 11, 11, s.trim);
    px(x, y, 9, 9, [190, 228, 250]);
    px(x, y + 5, 9, 4, [255, 230, 160]);
    px(x + 4, y, 1, 9, s.trim);
    px(x, y + 4, 9, 1, s.trim);
    px(x + 1, y + 1, 2, 1, [240, 250, 255]);
    px(x - 1, y + 10, 11, 2, [140, 92, 54]);            // window box
    [[1, 0], [4, -1], [7, 0]].forEach(([fx, fy], i) => px(x + fx, y + 9 + fy, 2, 1, FLOWER_COLORS[i % FLOWER_COLORS.length]));
  });

  // Sign board with district emblem
  px(17, 33, 14, 9, s.trim);
  px(18, 34, 12, 7, mix(s.trim, [0, 0, 0], 0.25));
  grid(20, 34, EMBLEMS[emblem], EMBLEM_PAL);

  // Arched open doorway (the portal sits right in front of it)
  const dx = 19, dy = 45, dw = 10, dh = 15;
  px(dx - 1, dy + 1, dw + 2, dh, s.trim);
  px(dx, dy, dw, 1, s.trim);
  px(dx + 1, dy - 1, dw - 2, 1, s.trim);
  px(dx, dy + 1, dw, dh - 1, [44, 28, 20]);
  px(dx + 1, dy, dw - 2, 1, [44, 28, 20]);
  px(dx, dy + dh - 4, dw, 4, [98, 64, 40]);             // light spilling onto the floor
  px(dx + 2, dy + dh - 5, dw - 4, 1, [140, 96, 60]);
  px(dx - 2, 60, dw + 4, 2, [176, 170, 160]);           // doorstep
}

function drawCastle(k) {
  const { px, grid } = k;
  const stone = [176, 172, 166], stoneDark = [140, 136, 132], stoneLight = [206, 202, 196], mortar = [112, 108, 106];
  const brickWall = (x0, y0, w, h) => {
    px(x0, y0, w, h, stone);
    for (let y = y0 + 3; y < y0 + h; y += 4) {
      px(x0, y, w, 1, mortar);
      const off = Math.floor((y - y0) / 4) % 2 ? 4 : 0;
      for (let x = x0 + off; x < x0 + w; x += 8) px(x, y + 1, 1, 3, mortar);
    }
    px(x0, y0, 1, h, stoneLight);
    px(x0 + w - 1, y0, 1, h, stoneDark);
  };
  const crenels = (x0, y, w) => {
    for (let x = x0; x < x0 + w; x += 4) {
      px(x, y, 3, 3, stone);
      px(x, y, 3, 1, stoneLight);
      px(x + 2, y, 1, 3, stoneDark);
    }
  };
  // Keep
  brickWall(14, 24, 52, 44);
  crenels(14, 21, 52);
  // Towers
  [[0, 8], [62, 8]].forEach(([x, y]) => {
    brickWall(x, y + 3, 18, 57);
    crenels(x, y, 18);
    // arrow-slit windows
    [[x + 8, y + 16], [x + 8, y + 34]].forEach(([wx, wy]) => {
      px(wx, wy, 2, 6, [40, 34, 44]);
      px(wx, wy - 1, 2, 1, stoneDark);
    });
    // flag
    px(x + 8, y - 8, 1, 8, [90, 70, 50]);
    px(x + 9, y - 8, 7, 4, [230, 72, 77]);
    px(x + 9, y - 8, 7, 1, [255, 120, 120]);
  });
  // Banners either side of the gate
  [[24, 32], [50, 32]].forEach(([x, y]) => {
    px(x, y, 6, 13, [210, 160, 40]);
    px(x + 1, y + 1, 4, 10, [230, 72, 77]);
    px(x + 2, y + 4, 2, 2, [255, 214, 70]);
    px(x, y + 13, 2, 2, [210, 160, 40]);
    px(x + 4, y + 13, 2, 2, [210, 160, 40]);
  });
  // Emblem plaque over the gate
  px(35, 27, 10, 9, [210, 160, 40]);
  px(36, 28, 8, 7, [120, 72, 40]);
  grid(36, 28, EMBLEMS.castle, EMBLEM_PAL);
  // Gate: arched, open, glowing
  const gx = 32, gy = 42, gw = 16, gh = 26;
  px(gx - 2, gy + 3, gw + 4, gh - 3, stoneDark);
  px(gx, gy, gw, 3, stoneDark);
  px(gx + 2, gy - 2, gw - 4, 2, stoneDark);
  px(gx, gy + 3, gw, gh - 3, [44, 32, 28]);
  px(gx + 2, gy, gw - 4, 3, [44, 32, 28]);
  px(gx, gy + gh - 6, gw, 6, [120, 86, 44]);
  for (let x = gx + 2; x < gx + gw; x += 3) px(x, gy + 1, 1, 8, [160, 150, 140]); // raised portcullis
  px(gx - 3, 68, gw + 6, 2, stoneLight);                // steps
  px(0, 68, 80, 4, [128, 122, 114]);                    // foundation
  px(0, 68, 80, 1, [160, 154, 146]);
}

export const BUILDING_SPRITE = {
  house:  { w: 48, h: 64 },
  castle: { w: 80, h: 72 },
};

export function generateBuildings(scene) {
  Object.entries(STYLES).forEach(([key, style]) => {
    const c = canvas(BUILDING_SPRITE.house.w * P, BUILDING_SPRITE.house.h * P);
    drawHouse(kit(c), style, key);
    uploadCanvas(scene, `bld_${key}`, c);
  });
  const c = canvas(BUILDING_SPRITE.castle.w * P, BUILDING_SPRITE.castle.h * P);
  drawCastle(kit(c));
  uploadCanvas(scene, 'bld_castle', c);
}
