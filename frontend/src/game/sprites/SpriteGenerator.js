// Procedural pixel-art sprite generator using canvas.
// All sprites are generated at runtime — no external image files required.

const NES = {
  black:      '#000000',
  white:      '#fcfcfc',
  lgray:      '#bcbcbc',
  mgray:      '#7c7c7c',
  dgray:      '#3c3c3c',
  red:        '#d82800',
  lred:       '#f87858',
  orange:     '#fc7820',
  lorange:    '#fca044',
  yellow:     '#f8b800',
  lyellow:    '#fcd860',
  green:      '#009c48',
  lgreen:     '#58d854',
  teal:       '#008888',
  lteal:      '#58d8a8',
  blue:       '#0028f8',
  lblue:      '#6888fc',
  sky:        '#3cbcfc',
  lsky:       '#a4e4fc',
  purple:     '#6844fc',
  lpurple:    '#b0a4f8',
  brown:      '#503000',
  lbrown:     '#c07840',
  skin:       '#fcd8a8',
  darkskin:   '#f0a060',
  transparent: null,
};

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Upload a canvas directly as a Phaser CanvasTexture.
// This avoids the async HTMLImageElement loading race that causes
// "INVALID_VALUE: texImage2D: no image" in headless/SwiftShader WebGL.
function addCanvasTexture(scene, key, canvas) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, canvas.width, canvas.height);
  tex.context.drawImage(canvas, 0, 0);
  tex.refresh();
  return tex;
}

// Same as above but also registers sprite-sheet frames by index.
function addCanvasSpriteSheet(scene, key, canvas, frameWidth, frameHeight) {
  const tex = addCanvasTexture(scene, key, canvas);
  const cols = Math.floor(canvas.width  / frameWidth);
  const rows = Math.floor(canvas.height / frameHeight);
  for (let i = 0; i < cols * rows; i++) {
    tex.add(i, 0, (i % cols) * frameWidth, Math.floor(i / cols) * frameHeight, frameWidth, frameHeight);
  }
  return tex;
}

function drawPixel(ctx, x, y, color, scale = 1) {
  if (!color) return;
  ctx.fillStyle = color;
  ctx.fillRect(x * scale, y * scale, scale, scale);
}

function drawGrid(ctx, grid, palette, scale = 1) {
  // Clip each row to the width of the first row so inconsistent row lengths
  // in grid definitions don't draw beyond the canvas boundary.
  const expectedW = grid[0]?.length ?? 0;
  grid.forEach((row, y) =>
    [...row].slice(0, expectedW).forEach((code, x) => {
      const color = palette[code];
      if (color) drawPixel(ctx, x, y, color, scale);
    })
  );
}

// ─── TILESET (16×16 each, 4 cols wide) ────────────────────────────────────────

const TILE_SCALE = 2; // render at 32×32 display
const TILE_SRC   = 16;
const TILES_PER_ROW = 8;

const TILE_DEFS = {
  grass: {
    // Cleaner lawn — sparse darker flecks so it reads as solid green
    grid: [
      'gggggggggggggggg',
      'gggggggggggggggg',
      'ggGggggggggggggg',
      'gggggggggggggggg',
      'ggggggggGggggggg',
      'gggggggggggggggg',
      'ggggGggggggggggg',
      'gggggggggggggggg',
      'gggggggggggggggg',
      'gggGgggggggggggg',
      'gggggggggggggggg',
      'ggggggGggggggggg',
      'gggggggggggggggg',
      'ggggggggggGggggg',
      'gggggggggggggggg',
      'ggGggggggggggggg',
    ],
    p: { g: NES.lgreen, G: NES.green },
  },
  dirt: {
    grid: [
      'dddddddddddddddd',
      'dddDdddddDdddddd',
      'ddddddDddddddDdd',
      'ddDddddddddddddd',
      'ddddddddDdddddDd',
      'ddddDddddddddddd',
      'dddddddddDdddddd',
      'ddDddddddddDdddd',
      'dddddddddddddddd',
      'dddDdddDdddddddd',
      'ddddddddddDddddd',
      'ddddDdddddddddDd',
      'ddddddDddddddddd',
      'ddDdddddddDddddd',
      'dddddddddddddddd',
      'ddddddDddddddDdd',
    ],
    p: { d: NES.lbrown, D: NES.brown },
  },
  water: {
    // Deeper blue — clear contrast from the green land
    grid: [
      'bbbbwwwbbbbbwwwb',
      'bwwwbbbbbbwwbbbb',
      'bbbbbbwwwbbbbbww',
      'wwwbbbbbbbbwwbbb',
      'bbbbwwwbbbbbwwwb',
      'bwwwbbbbbbwwbbbb',
      'bbbbbbwwwbbbbbww',
      'wwwbbbbbbbbwwbbb',
      'bbbbwwwbbbbbwwwb',
      'bwwwbbbbbbwwbbbb',
      'bbbbbbwwwbbbbbww',
      'wwwbbbbbbbbwwbbb',
      'bbbbwwwbbbbbwwwb',
      'bwwwbbbbbbwwbbbb',
      'bbbbbbwwwbbbbbww',
      'wwwbbbbbbbbwwbbb',
    ],
    p: { b: NES.blue, w: NES.sky },
  },
  path: {
    // Stone/sandy path — light gray-tan, clearly distinct from green grass
    grid: [
      'pppppppppppppppp',
      'pPppppppPppppppp',
      'ppppppppppppppPp',
      'pppPpppppppppppp',
      'pppppppppPpppppp',
      'ppppPppppppppppp',
      'pppppppppppppppp',
      'pPpppppppppPpppp',
      'pppppppppppppppp',
      'ppppPpppPppppppp',
      'pppppppppppppppp',
      'pppppppppppPpppp',
      'ppppPppppppppppp',
      'pppppppppppppppp',
      'ppppppppPppppppp',
      'ppPppppppppppppp',
    ],
    p: { p: NES.lgray, P: NES.white },
  },
  tree_top: {
    // '.' is mapped to grass so no transparent black corners appear
    grid: [
      'ggggGGGGGGGGgggg',
      'gggGGGGGGGGGGggg',
      'ggGGGGGGGGGGGGGg',
      'gGGGGtGGGGGGGGGg',
      'GGGGGGGGtGGGGGGG',
      'GGGtGGGGGGGGGGGG',
      'GGGGGGGGGGtGGGGG',
      'GGGGtGGGGGGGGGGG',
      'GGGGGGGGGGGGtGGG',
      'GGGGGGtGGGGGGGGG',
      'gGGGGGGGGGGGtGGg',
      'ggGGGGGGGGGGGGgg',
      'gggGGGGGGGGGGggg',
      'ggggGGGGGGGGgggg',
      'gggggBBBBBBggggg',
      'ggggggBBBBgggggg',
    ],
    p: { G: NES.lgreen, t: NES.green, B: NES.brown, g: NES.lgreen },
  },
  tree_bot: {
    // grass fill so trunk blends into the map
    grid: [
      'ggggggBBBBgggggg',
      'ggggggBBBBgggggg',
      'ggggbbbbbbbbgggg',
      'ggggbbbbbbbbgggg',
      'ggggbbbbbbbbgggg',
      'ggggbbbbbbbbgggg',
      'ggggggbbbbgggggg',
      'ggggggbbbbgggggg',
      'gggggbbbbbbbgggg',
      'gggggbbbbbbbgggg',
      'gggbbbbbbbbbbggg',
      'gggbbbbbbbbbbggg',
      'gggbbbbbbbbbbggg',
      'gggbbbbbbbbbbggg',
      'gggggggggggggggg',
      'gggggggggggggggg',
    ],
    p: { B: NES.brown, b: NES.lbrown, g: NES.lgreen },
  },
  wall: {
    grid: [
      'SSSSSSSSSSSSSSSS',
      'SsssSsssSsssSsss',
      'SsssSsssSsssSsss',
      'SSSSSSSSSSSSSSSS',
      'sSSSSSSSSSSSSSSs',
      'SsssSsssSsssSsss',
      'SsssSsssSsssSsss',
      'SSSSSSSSSSSSSSSS',
      'SsssSsssSsssSsss',
      'SsssSsssSsssSsss',
      'SSSSSSSSSSSSSSSS',
      'sSSSSSSSSSSSSSSs',
      'SsssSsssSsssSsss',
      'SsssSsssSsssSsss',
      'SSSSSSSSSSSSSSSS',
      'SSSSSSSSSSSSSSSS',
    ],
    p: { S: NES.mgray, s: NES.lgray },
  },
  flower: {
    grid: [
      'gggggggggggggggg',
      'gggggggggggggggg',
      'ggGgggggggGggggg',
      'gGrGggggGrGgggGG',
      'ggGggggggGgggGgG',
      'ggggggggggggGGgg',
      'ggggGGgggggggGgg',
      'gggGrGggggggggg',
      'ggggGGgggGGggggg',
      'ggggggggGrGggggg',
      'ggggggggGGgggGGg',
      'gggGGgggggggGrGg',
      'ggGrGgggggggGGgg',
      'gggGGgggggggggg',
      'gggggggggggggggg',
      'gggggggggggggggg',
    ],
    p: { g: NES.lgreen, G: NES.green, r: NES.red },
  },
};

export function generateTileset(scene) {
  const cols = TILES_PER_ROW;
  const keys = Object.keys(TILE_DEFS);
  const rows = Math.ceil(keys.length / cols);
  const W = cols * TILE_SRC * TILE_SCALE;
  const H = rows * TILE_SRC * TILE_SCALE;

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  keys.forEach((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * TILE_SRC * TILE_SCALE;
    const oy = row * TILE_SRC * TILE_SCALE;
    const def = TILE_DEFS[key];
    const subCtx = c.getContext('2d');
    subCtx.save();
    subCtx.translate(ox, oy);
    drawGrid(subCtx, def.grid, def.p, TILE_SCALE);
    subCtx.restore();
  });

  addCanvasTexture(scene, 'tileset', c);

  // Return tile index map
  const map = {};
  keys.forEach((k, i) => { map[k] = i; });
  return map;
}

// ─── PLAYER SPRITE SHEET ──────────────────────────────────────────────────────
// 4 directions × 3 frames each = 12 frames, 16×16 each → sheet 192×16

const PLAYER_FRAMES = {
  // down/side walk: frames 0,1,2 — hero faces the viewer
  down: [
    // frame 0 (stand)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SsSSSSSSsS...',
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HhHHHHHhHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHbbHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '...LL......LL...',
      '...LL......LL...',
      '..llll....llll..',
      '................',
    ],
    // frame 1 (walk L)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SsSSSSSSsS...',
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HhHHHHHhHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHbbHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '..LLL......LL...',
      '...LL......LLL..',
      '..llll.....lll..',
      '................',
    ],
    // frame 2 (walk R)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SsSSSSSSsS...',
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HhHHHHHhHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHbbHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '...LL......LLL..',
      '..LLL......LL...',
      '..lll.....llll..',
      '................',
    ],
  ],
  // up walk: frames 0,1,2 — back-of-head, no eye pixels visible
  up: [
    // frame 0 (stand, back)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SSSSSSSSSS...',  // no eye pixels — back of head
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HHHHHHHHHH...',  // plain back of tunic
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '...LL......LL...',
      '...LL......LL...',
      '..llll....llll..',
      '................',
    ],
    // frame 1 (walk L, back)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SSSSSSSSSS...',
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HHHHHHHHHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '..LLL......LL...',
      '...LL......LLL..',
      '..llll.....lll..',
      '................',
    ],
    // frame 2 (walk R, back)
    [
      '....SSSSSSSS....',
      '...SSSSSSSSSS...',
      '...SSSSSSSSSS...',
      '...SSSSSSSSSS...',
      '....HHHHHHHH....',
      '...HHHHHHHHHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHHH..',
      '..BBBBBBBBBBBB..',
      '..BBBBBBBBBBB...',
      '..BBB......BBB..',
      '...LL......LLL..',
      '..LLL......LL...',
      '..lll.....llll..',
      '................',
    ],
  ],
};

const PLAYER_PALETTE = {
  S: NES.skin,    s: NES.darkskin,
  H: NES.lgreen,  h: NES.green,    // green tunic — easy to read as hero
  b: NES.lyellow,                   // gold belt/buckle detail
  B: NES.lblue,                     // blue pants
  L: NES.lbrown,  l: NES.brown,    // brown boots
  A: NES.lgray,   a: NES.white,    // broom handle (light gray shaft, white tip)
  '.': null,
};

// Attack frames — one per cardinal direction (arm extended with broom)
// These are appended after the 12 walk frames: indices 12..15
const PLAYER_ATTACK_FRAMES = {
  down: [
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SsSSSSSSsS...',
    '...SSSSSSSSSS...',
    '....HHHHHHHH....',
    '...HhHHHHHhHH...',
    '..HHHHHHHHHHHH..',
    '..HHHHbbHHHHHH..',
    '..HHHHHHHHHAHHH.',
    '..BBBBBBBBBAHHH.',
    '..BBBBBBBBBA....',
    '..BBB.....Aa....',
    '...LL.....A.....',
    '...LL......LL...',
    '..llll....llll..',
    '................',
  ],
  up: [
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '....HHHHHHHH....',
    '...HHHHHHHHHH...',
    '..HHHHHHHHHAAH..',
    '..HHHHHHHHAAaH..',
    '..HHHHHHHHAAHH..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBB...',
    '..BBB......BBB..',
    '...LL......LL...',
    '...LL......LL...',
    '..llll....llll..',
    '................',
  ],
  right: [
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SsSSSSSSsS...',
    '...SSSSSSSSSS...',
    '....HHHHHHHH....',
    '...HhHHHHHhHH...',
    '..HHHHHHHHHHHH..',
    '..HHHHbbHHAAAAa.',
    '..HHHHHHHHHHHH..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBB...',
    '..BBB......BBB..',
    '...LL......LL...',
    '...LL......LL...',
    '..llll....llll..',
    '................',
  ],
  left: [
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SsSSSSSSsS...',
    '...SSSSSSSSSS...',
    '....HHHHHHHH....',
    '...HhHHHHHhHH...',
    '..HHHHHHHHHHHH..',
    '.aAAAAHHbbHHHHH.',
    '..HHHHHHHHHHHH..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBB...',
    '..BBB......BBB..',
    '...LL......LL...',
    '...LL......LL...',
    '..llll....llll..',
    '................',
  ],
};

export function generatePlayerSheet(scene) {
  const WALK_FRAMES   = 12; // 4 dirs × 3 walk frames
  const ATTACK_FRAMES = 4;  // 1 per direction (down/left/right/up) = indices 12..15
  const TOTAL_FRAMES  = WALK_FRAMES + ATTACK_FRAMES;
  const FS = 16;
  const SCALE = 2;
  const W = TOTAL_FRAMES * FS * SCALE;
  const H = FS * SCALE;

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // Dir-specific palettes
  const palettes = [
    PLAYER_PALETTE,                           // down
    { ...PLAYER_PALETTE },                    // left
    { ...PLAYER_PALETTE },                    // right
    { ...PLAYER_PALETTE },                    // up (back-of-head)
  ];

  // Walk frames (0–11)
  for (let dir = 0; dir < 4; dir++) {
    for (let f = 0; f < 3; f++) {
      const frameIdx = dir * 3 + f;
      const ox = frameIdx * FS * SCALE;
      const src = (dir === 3) ? PLAYER_FRAMES.up[f % 3] : PLAYER_FRAMES.down[f % 3];
      ctx.save();
      ctx.translate(ox, 0);
      if (dir === 1) {           // flip for left
        ctx.translate(FS * SCALE, 0);
        ctx.scale(-1, 1);
      }
      drawGrid(ctx, src, palettes[dir], SCALE);
      ctx.restore();
    }
  }

  // Attack frames (12–15): down, left, right, up
  const attackOrder = [
    PLAYER_ATTACK_FRAMES.down,
    PLAYER_ATTACK_FRAMES.left,
    PLAYER_ATTACK_FRAMES.right,
    PLAYER_ATTACK_FRAMES.up,
  ];
  attackOrder.forEach((grid, i) => {
    const ox = (WALK_FRAMES + i) * FS * SCALE;
    ctx.save();
    ctx.translate(ox, 0);
    drawGrid(ctx, grid, PLAYER_PALETTE, SCALE);
    ctx.restore();
  });

  addCanvasSpriteSheet(scene, 'player', c, FS * SCALE, FS * SCALE);
}

// ─── ENEMY SPRITES ────────────────────────────────────────────────────────────

const ENEMY_DEFS = {
  dust_bunny: {
    frames: [
      [
        '....WWWWWWWW....',
        '..WWWWWWWWWWWW..',
        '.WWWWWwWWWwWWWW.',
        'WWWWWWWWWWWWWWwW',
        'WWwWWWWWWWWWWWWW',
        'WWWWWWbbWWbbWWWW',
        'WWWWWWbbWWbbWWWW',
        'WWWWWWWWRRWWWWWW',
        'WWWWWWWWWWWWWWWW',
        '.WWWWWWWWWWWWWW.',
        '..WWWWWWWWWWWW..',
        '...WWWWWWWWWW...',
        '....EEEEEEEE....',
        '.....EEEEEE.....',
        '....EE....EE....',
        '................',
      ],
      [
        '....WWWWWWWW....',
        '..WWWWWWWWWWWW..',
        '.WWWwWWWWWWwWWW.',
        'WwWWWWWWWWWWWWWW',
        'WWWWWWWwWWWWWWWW',
        'WWWWWWbbWWbbWWWW',
        'WWWWWWbbWWbbWWWW',
        'WWWWWWWWRRWWWWWW',
        'WWWWWWWWWWWWWWWW',
        '.WWWWWWWWWWWWWW.',
        '..WWWWWWWWWWWW..',
        '...WWWWWWWWWW...',
        '....EEEEEEEE....',
        '.....EEEEEE.....',
        '....EE....EE....',
        '................',
      ],
    ],
    p: { W: NES.lgray, w: NES.white, b: NES.black, R: NES.lred, E: NES.lbrown, '.': null },
  },
  sock_goblin: {
    frames: [
      [
        '......PPPP......',
        '.....PPPPPP.....',
        '....PPpPPpPP....',
        '....PPPPPPPP....',
        '....PPBBbbPP....',
        '....PPBBbbPP....',
        '....PPPPPPPP....',
        '...PPPPPPPPPP...',
        '..PPPPPPPPPPPP..',
        '..PPSSSSSSSSPP..',
        '..PPSSSSSSSSPP..',
        '..PPPPPPPPPPPP..',
        '....PP....PP....',
        '....PP....PP....',
        '...PPP....PPP...',
        '................',
      ],
      [
        '......PPPP......',
        '.....PPPPPP.....',
        '....PPpPPpPP....',
        '....PPPPPPPP....',
        '....PPBBbbPP....',
        '....PPBBbbPP....',
        '....PPPPPPPP....',
        '..PPPPPPPPPPPP..',
        '...PPPPPPPPPP...',
        '..PPSSSSSSSSPP..',
        '..PPSSSSSSSSPP..',
        '..PPPPPPPPPPPP..',
        '....PP....PP....',
        '...PPP....PP....',
        '....PP....PPP...',
        '................',
      ],
    ],
    p: { P: NES.lpurple, p: NES.purple, B: NES.black, b: NES.mgray, S: NES.lgray, '.': null },
  },
  crumb_slime: {
    frames: [
      [
        '................',
        '................',
        '......BBBB......',
        '....BBBBBBBB....',
        '...BBBbbBBBBB...',
        '..BBBBBBbbBBBB..',
        '..BBBBbbBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBwwBBBwwBBB..',
        '..BBwwBBBwwBBB..',
        '..BBBBBBBBBBBB..',
        '...BBBBBBBBBB...',
        '....BBBBBBBB....',
        '......BBBB......',
        '................',
        '................',
      ],
      [
        '................',
        '......BBBB......',
        '....BBBBBBBB....',
        '...BBBbbBBBBB...',
        '..BBBBBBbbBBBB..',
        '..BBBBbbBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBwwBBBwwBBB..',
        '..BBwwBBBwwBBB..',
        '..BBBBBBBBBBBB..',
        '...BBBBBBBBBB...',
        '....BBBBBBBB....',
        '......BBBB......',
        '................',
        '................',
        '................',
      ],
    ],
    // Teal replaces lbrown/brown — crumb slime was previously invisible on dirt tiles
    p: { B: NES.lteal, b: NES.teal, w: NES.white, '.': null },
  },
};

export function generateEnemySheets(scene) {
  Object.entries(ENEMY_DEFS).forEach(([key, def]) => {
    const FRAMES = def.frames.length;
    const FS = 16;
    const SCALE = 2;
    const c = createCanvas(FRAMES * FS * SCALE, FS * SCALE);
    const ctx = c.getContext('2d');
    def.frames.forEach((grid, i) => {
      ctx.save();
      ctx.translate(i * FS * SCALE, 0);
      drawGrid(ctx, grid, def.p, SCALE);
      ctx.restore();
    });
    addCanvasSpriteSheet(scene, `enemy_${key}`, c, FS * SCALE, FS * SCALE);
  });
}

// ─── BOSS SPRITES (16×16 source, displayed at 2.2× = ~70px) ─────────────────────

const BOSS_DEFS = {
  grime_lord: {
    frames: [
      [
        '....yyyyyyy.....',
        '...yyyYyyyyy....',
        '....GGGGGGG.....',
        '...GGGGGGGGGGG..',
        '..GGGggGGGGGGG..',
        '..GGGGGGggGGGGG.',
        '..GGGGGGGGGGGGG.',
        '..GGeeGGGeeGGGG.',
        '..GGeeGGGeeGGGG.',
        '..GGGGmmGGGGGGG.',
        '..GGGGGGGGGGGG..',
        '...GGGGGGGGGG...',
        '....GGGGGGGG....',
        '......GGGG......',
        '................',
        '................',
      ],
      [
        '....yyyyyyy.....',
        '...yYyyyyy......',
        '....GGGGGGG.....',
        '..GGGGGGGGGGG...',
        '..GGGGGGGGGGgg..',
        '..GGggGGGGGGGG..',
        '..GGGGGGGGGGGGG.',
        '..GGeeGGGeeGGGG.',
        '..GGeeGGGeeGGGG.',
        '..GGGGmmGGGGGGG.',
        '..GGGGGGGGGGGG..',
        '...GGGGGGGGGG...',
        '....GGGGGGGG....',
        '......GGGG......',
        '................',
        '................',
      ],
    ],
    p: { G: NES.green, g: NES.teal, y: NES.lyellow, Y: NES.white, e: NES.white, m: NES.lred, '.': null },
  },
  lint_titan: {
    frames: [
      [
        '................',
        '...LLLLLLLLL....',
        '..LLLlLlLLLLL...',
        '.LLLLLLLLLLLLl..',
        'LLLLLLLLLLLLLLl.',
        'LlLLLbbLLbbLLLL.',
        'LLLLLbbLLbbLLLL.',
        'LLLLLLLLLLLLLlL.',
        'LLLLLLRRLLLLLll.',
        '.LLLLLRRLLLLlL..',
        '..LLLLLLLLLLL...',
        '...LLLLLLLLL....',
        '.....LLLLL......',
        '................',
        '................',
        '................',
      ],
      [
        '................',
        '...LLLLLLLLL....',
        '..LlLLLLLLLLL...',
        '.LLLLLlLLLLLLL..',
        'LLLLLLLLLLLLLlL.',
        'LLLLLbbLLbbLLlL.',
        'LLLLLbbLLbbLLLL.',
        'LlLLLLLLLLLLLLL.',
        'LLLLLLRRLLLLLll.',
        '.LLLLRRLLLLLlL..',
        '..LLLLLLLLlLL...',
        '...LLLLLLLLL....',
        '.....LLLLL......',
        '................',
        '................',
        '................',
      ],
    ],
    // Eyes changed black→lred: glowing red eyes pop against the dark night overlay
    p: { L: NES.lpurple, l: NES.lgray, b: NES.lred, R: NES.red, '.': null },
  },
  weed_golem: {
    frames: [
      [
        '...vvVv.........',
        '..vvvVvVv.......',
        '..vBBBBBBv......',
        '.vBBBBBBBBBv....',
        'vBBBBBBBBBBBBv..',
        '.BBBBEEBEEBBBv..',
        '.BBBBEEBEEBBBv..',
        '.BBBBBBBBBBBBv..',
        '.BBBBrrBBBBBB...',
        '.BBBBBBBBBBB....',
        '..BBBBBBBBB.....',
        '...vBBBBBBv.....',
        '....vBBBBv......',
        '.....vBBv.......',
        '......vv........',
        '................',
      ],
      [
        '..vvVvv.........',
        '..vvVvvVv.......',
        '.vBBBBBBBv......',
        'vBBBBBBBBBBv....',
        '.BBBBBBBBBBBBv..',
        '.BBBBEEBEEBBBv..',
        '.BBBBEEBEEBBBv..',
        '.BBBBBBBBBBBBv..',
        '.BBBBrrBBBBBB...',
        '..BBBBBBBBBB....',
        '...BBBBBBBBB....',
        '....vBBBBBv.....',
        '.....vBBBv......',
        '......vBv.......',
        '......vv........',
        '................',
      ],
    ],
    // Body changed to teal — was previously grass-colored (lgreen/green), invisible on the map
    p: { B: NES.teal, v: NES.green, V: NES.lyellow, E: NES.lyellow, r: NES.lred, '.': null },
  },
  paper_wraith: {
    frames: [
      [
        '................',
        '....PPPPPPPP....',
        '...PPPPPPPPPP...',
        '..PPPPpPPPPPPP..',
        '..PPPPPPPPpPPP..',
        '..PPPRRPPRRpPP..',
        '..PPPRRPPRRpPP..',
        '..PPPPPPPPpPPP..',
        '..PPPPPPPPppPP..',
        '..PPPmmmmmmPPP..',
        '..PPPPPPPPPPPP..',
        '...PPPpppPPPP...',
        '...PP.......PP..',
        '....P.........P.',
        '................',
        '................',
      ],
      [
        '................',
        '....PPPPPPPP....',
        '...PPPPPPppPP...',
        '..PPPpPPPPPPPP..',
        '..PPPPPPPPPpPP..',
        '..PPPRRPPRRpPP..',
        '..PPPRRPPRRpPP..',
        '..PPPPPPPPpPPP..',
        '..PPPpPPPPPPPP..',
        '..PPPmmmmmmPPP..',
        '..PPPPPPPPPPPP..',
        '...pPPPpPPPP....',
        '...PP.......PP..',
        '....P.........P.',
        '................',
        '................',
      ],
    ],
    // Darkened to lgray/mgray — was white/lgray, nearly invisible on light path tiles
    p: { P: NES.lgray, p: NES.mgray, R: NES.red, m: NES.dgray, '.': null },
  },
};

export function generateBossSheets(scene) {
  Object.entries(BOSS_DEFS).forEach(([key, def]) => {
    const FRAMES = def.frames.length;
    const FS = 16;
    const SCALE = 2;
    const c = createCanvas(FRAMES * FS * SCALE, FS * SCALE);
    const ctx = c.getContext('2d');
    def.frames.forEach((grid, i) => {
      ctx.save();
      ctx.translate(i * FS * SCALE, 0);
      drawGrid(ctx, grid, def.p, SCALE);
      ctx.restore();
    });
    addCanvasSpriteSheet(scene, `enemy_${key}`, c, FS * SCALE, FS * SCALE);
  });
}

// ─── BUILDING SPRITES (32×32) ─────────────────────────────────────────────────

const BUILDING_DEFS = {
  kitchen: {
    grid: [
      '................RRRRRRRRRRRRRRRR',
      '...............RRRRRRRRRRRRRRRRRR',
      '..............RRRRRRRRRRRRRRRRRRRR',
      '.............RRRRRRRRRRRRRRRRRRRRRR',
      '............RRRRRRrRRRRRRrRRRRRRRR',
      '...........RRRRRRRrRRRRRRrRRRRRRRRR',
      '...........RRRRRRRRRRRRRRRRRRRRRRRR.',
      '...........WWWWWWWWWWWWWWWWWWWWWWW.',
      '...........WbbWWWWWbbbbbbbWWWWbbW..',
      '...........WbbWWWWWbbbbbbbWWWWbbW..',
      '...........WbbWWWWWbbbbbbbWWWWbbW..',
      '...........WWWWWWWWWWWWWWWWWWWWWW..',
      '...........WWWWWWWWWWWWWWWWWWWWWW..',
      '...........WWDDDWWWWWWWWWWWWWWWWW..',
      '...........WWDDDWWWWWWWWWWWWWWWWW..',
      '...........WWDDDWWWWWWWWWWWWWWWWW..',
      '...........WWWWWWWWWWWWWWWWWWWWWW..',
      '...........WWWWWWWWWWWWWWWWWWWWWW..',
      '...........WWWWWWWWWWWWWWWWWWWWWW..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '...........GGGGGGGGGGGGGGGGGGGGGG..',
      '..........GGGGGGGGGGGGGGGGGGGGGGG..',
      '..........GGGGGGGGGGGGGGGGGGGGGGG..',
      '..........GGGGGGGGGGGGGGGGGGGGGGG..',
    ],
    p: {
      R: NES.red, r: NES.lred,
      W: NES.lgray, w: NES.white,
      b: NES.sky, D: NES.brown,
      G: NES.lgreen, '.': null,
    },
  },
  laundry: {
    grid: [
      '................BBBBBBBBBBBBBBBB',
      '...............BBBBBBBBBBBBBBBBBB',
      '..............BBBBBBbBBBBBbBBBBBBB',
      '.............BBBBBBBbBBBBBbBBBBBBBB',
      '............BBBBBBBBbBBBBBbBBBBBBBBB',
      '...........BBBBBBBBBBBBBBBBBBBBBBBBB.',
      '...........WWWWWWWWWWWWWWWWWWWWWWWW.',
      '...........WrrrrrrWWrrrrrrWWrrrrrrrW.',
      '...........WrCCCCrWWrCCCCrWWrCCCCrW.',
      '...........WrCCCCrWWrCCCCrWWrCCCCrW.',
      '...........WrCCCCrWWrCCCCrWWrCCCCrW.',
      '...........WrrrrrrWWrrrrrrWWrrrrrrrW.',
      '...........WWWWWWWWWWWWWWWWWWWWWWWW.',
      '...........WWDDDWWWWWWWWWWWWWWWWWWW.',
      '...........WWDDDWWWWWWWWWWWWWWWWWWW.',
      '...........WWDDDWWWWWWWWWWWWWWWWWWW.',
      '...........WWWWWWWWWWWWWWWWWWWWWWWW.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '...........GGGGGGGGGGGGGGGGGGGGGGGG.',
      '..........GGGGGGGGGGGGGGGGGGGGGGGGG.',
      '..........GGGGGGGGGGGGGGGGGGGGGGGGG.',
      '..........GGGGGGGGGGGGGGGGGGGGGGGGG.',
      '..........GGGGGGGGGGGGGGGGGGGGGGGGG.',
      '..........GGGGGGGGGGGGGGGGGGGGGGGGG.',
    ],
    p: {
      B: NES.lblue, b: NES.blue,
      W: NES.lgray, r: NES.lred, C: NES.sky,
      D: NES.brown, G: NES.lgreen, '.': null,
    },
  },
  reward_castle: {
    grid: [
      'YYYY..YYYYYY..YYYY......YYYY..YYYYYY..YYYY',
      'YYYY..YYYYYY..YYYY......YYYY..YYYYYY..YYYY',
      'YYYYYYYYYYYYYYYYYY......YYYYYYYYYYYYYYYYYY',
      'YYYYYYYYYYYYYYYYYY......YYYYYYYYYYYYYYYYYY',
      'YYYYYYYYYYYYYYYYYYyyyyyYYYYYYYYYYYYYYYYYY',
      'YYYYYYYYYYYYYYYYYYyyyyyYYYYYYYYYYYYYYYYYY',
      'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WbbWWWWWWbbbbbbbbbbbbbbbbbbbbbWWWWWWWbbW',
      'WbbWWWWWWbbbbbbbbbbbbbbbbbbbbbWWWWWWWbbW',
      'WbbWWWWWWbbbbbbbbbbbbbbbbbbbbbWWWWWWWbbW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWDDDDDDWWWWWWWDDDDDDWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWDDDDDDDWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWDDDDDDDWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWDDDDDDDWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWDDDDDDDWWWWWWWWWWWWWWWWWW',
      'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
    ],
    p: {
      Y: NES.yellow, y: NES.lyellow,
      W: NES.lgray, b: NES.sky,
      D: NES.brown, G: NES.lgreen, '.': null,
    },
  },
};

export function generateBuildingSprites(scene) {
  Object.entries(BUILDING_DEFS).forEach(([key, def]) => {
    const rows = def.grid.length;
    const cols = def.grid[0].length;
    const SCALE = 3; // 3× so buildings stand ~3 tiles tall — clearly visible in the world
    const c = createCanvas(cols * SCALE, rows * SCALE);
    const ctx = c.getContext('2d');
    drawGrid(ctx, def.grid, def.p, SCALE);
    addCanvasTexture(scene, `building_${key}`, c);
  });
}

// ─── UI SPRITES ───────────────────────────────────────────────────────────────

export function generateUISprites(scene) {
  // Portal / quest marker — animated 16×16
  const PORTAL_FRAMES = 4;
  const FS = 16;
  const SCALE = 2;
  const pc = createCanvas(PORTAL_FRAMES * FS * SCALE, FS * SCALE);
  const pctx = pc.getContext('2d');
  const portalColors = [NES.lyellow, NES.yellow, NES.lorange, NES.yellow];
  const portalRings  = [NES.lgreen,  NES.green,  NES.lteal,   NES.teal];

  // Diamond portal shape: drawn as concentric rotated squares using NES-style pixel rows
  // Row pixel counts (half-diamond outline): 2, 4, 6, 8, 10, 12, 10, 8, 6, 8, 10, 12, 10, 8, 6, 4
  // This gives a 45°-rotated rhombus with a bright glow core and pulsing ring colours.
  const portalPixels = [
    // [outer ring x-start, width] for each row (16-row grid, centered in 16×16)
    [7,2],[6,4],[5,6],[4,8],[3,10],[2,12],[3,10],[4,8],   // top half
    [4,8],[3,10],[2,12],[3,10],[4,8],[5,6],[6,4],[7,2],   // bottom half
  ];
  for (let f = 0; f < PORTAL_FRAMES; f++) {
    pctx.save();
    pctx.translate(f * FS * SCALE, 0);
    portalPixels.forEach(([x, w], y) => {
      // Outer ring (1px border)
      pctx.fillStyle = portalRings[f];
      pctx.fillRect(x * SCALE, y * SCALE, w * SCALE, SCALE);
      // Inner glow (inset 1 pixel each side)
      if (w > 4) {
        pctx.fillStyle = portalColors[f];
        pctx.fillRect((x + 1) * SCALE, y * SCALE, (w - 2) * SCALE, SCALE);
      }
    });
    // Bright white core (2×2 at visual center)
    pctx.fillStyle = NES.white;
    pctx.fillRect(7 * SCALE, 7 * SCALE, 2 * SCALE, 2 * SCALE);
    pctx.restore();
  }
  addCanvasSpriteSheet(scene, 'portal', pc, FS * SCALE, FS * SCALE);

  // Coin sprite (8×8, 2 frames)
  const cc = createCanvas(4 * 8 * SCALE, 8 * SCALE);
  const cctx = cc.getContext('2d');
  [[NES.yellow, NES.lyellow], [NES.lyellow, NES.white], [NES.yellow, NES.lyellow], [NES.lorange, NES.yellow]].forEach(([bg, hi], f) => {
    cctx.save();
    cctx.translate(f * 8 * SCALE, 0);
    cctx.fillStyle = bg;
    cctx.fillRect(2 * SCALE, 0, 4 * SCALE, 8 * SCALE);
    cctx.fillRect(1 * SCALE, 1 * SCALE, 6 * SCALE, 6 * SCALE);
    cctx.fillStyle = hi;
    cctx.fillRect(2 * SCALE, 1 * SCALE, 2 * SCALE, 3 * SCALE);
    cctx.restore();
  });
  addCanvasSpriteSheet(scene, 'coin', cc, 8 * SCALE, 8 * SCALE);

  // Heart sprite (8×8 source, 2 states: full/empty)
  // Shape: two top lobes + tapered body → proper pointed tip at bottom.
  //   row 2: two 2px lobes (left & right)
  //   row 3–4: full 8px width (mid body)
  //   row 5: 6px (inset 1)
  //   row 6: 4px (inset 2)
  //   row 7: 2px (pointed tip)
  const hc = createCanvas(2 * 8 * SCALE, 8 * SCALE);
  const hctx = hc.getContext('2d');
  [[NES.red, NES.lred], [NES.dgray, NES.mgray]].forEach(([fg, hi], f) => {
    hctx.save();
    hctx.translate(f * 8 * SCALE, 0);
    hctx.fillStyle = fg;
    hctx.fillRect(1 * SCALE, 2 * SCALE, 2 * SCALE, 2 * SCALE); // left lobe
    hctx.fillRect(5 * SCALE, 2 * SCALE, 2 * SCALE, 2 * SCALE); // right lobe
    hctx.fillRect(0 * SCALE, 3 * SCALE, 8 * SCALE, 2 * SCALE); // full mid (rows 3-4)
    hctx.fillRect(1 * SCALE, 5 * SCALE, 6 * SCALE, 1 * SCALE); // row 5 taper
    hctx.fillRect(2 * SCALE, 6 * SCALE, 4 * SCALE, 1 * SCALE); // row 6 taper
    hctx.fillRect(3 * SCALE, 7 * SCALE, 2 * SCALE, 1 * SCALE); // row 7 pointed tip
    // Highlight pixel on each lobe (top-left corner)
    hctx.fillStyle = hi;
    hctx.fillRect(1 * SCALE, 2 * SCALE, 1 * SCALE, 1 * SCALE);
    hctx.fillRect(5 * SCALE, 2 * SCALE, 1 * SCALE, 1 * SCALE);
    hctx.restore();
  });
  addCanvasSpriteSheet(scene, 'heart', hc, 8 * SCALE, 8 * SCALE);

  // XP bar background (128×8) — NES-style with bracket notches at each end
  const xpW = 128, xpH = 8;
  const xpc = createCanvas(xpW, xpH);
  const xpctx = xpc.getContext('2d');
  xpctx.fillStyle = NES.black;
  xpctx.fillRect(0, 0, xpW, xpH);
  xpctx.fillStyle = NES.dgray;
  xpctx.fillRect(1, 1, xpW - 2, xpH - 2);
  // Bracket notches: 2×3 yellow marks at each end
  xpctx.fillStyle = NES.lyellow;
  xpctx.fillRect(0, 0, 2, 3);      // top-left bracket
  xpctx.fillRect(0, xpH - 3, 2, 3); // bottom-left bracket
  xpctx.fillRect(xpW - 2, 0, 2, 3); // top-right bracket
  xpctx.fillRect(xpW - 2, xpH - 3, 2, 3); // bottom-right bracket
  addCanvasTexture(scene, 'xpbar_bg', xpc);

  // XP bar fill — green with 1px lyellow highlight stripe at top
  const xpfc = createCanvas(xpW, xpH);
  const xpfctx = xpfc.getContext('2d');
  xpfctx.fillStyle = NES.lgreen;
  xpfctx.fillRect(0, 0, xpW, xpH);
  xpfctx.fillStyle = NES.green;
  xpfctx.fillRect(0, xpH - 2, xpW, 2);         // darker bottom stripe
  xpfctx.fillStyle = NES.lyellow;
  xpfctx.fillRect(0, 0, xpW, 1);               // bright top highlight
  addCanvasTexture(scene, 'xpbar_fill', xpfc);
}

export function generateAllSprites(scene) {
  generatePlayerSheet(scene);
  generateEnemySheets(scene);
  generateBossSheets(scene);
  generateBuildingSprites(scene);
  generateUISprites(scene);
  return generateTileset(scene);
}
