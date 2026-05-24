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
  grid.forEach((row, y) =>
    [...row].forEach((code, x) => {
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
  // down walk: frames 0,1,2
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
};

const PLAYER_PALETTE = {
  S: NES.skin,    s: NES.darkskin,
  H: NES.lgreen,  h: NES.green,    // green tunic — easy to read as hero
  b: NES.lyellow,                   // gold belt/buckle detail
  B: NES.lblue,                     // blue pants
  L: NES.lbrown,  l: NES.brown,    // brown boots
  '.': null,
};

// Directions: down=0, left=1, right=2, up=3 (each 3 frames)
function makePlayerFrame(frameIdx, dirOffset, palette) {
  const frames = PLAYER_FRAMES.down; // reuse for all dirs
  const src = frames[frameIdx % 3];
  return { grid: src, p: palette };
}

export function generatePlayerSheet(scene) {
  const FRAMES = 12; // 4 dirs × 3 frames
  const FS = 16;
  const SCALE = 2;
  const W = FRAMES * FS * SCALE;
  const H = FS * SCALE;

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // Dir-specific palette tints for left/right (slight flip simulation)
  const palettes = [
    PLAYER_PALETTE, // down
    { ...PLAYER_PALETTE }, // left — same base
    { ...PLAYER_PALETTE }, // right
    { ...PLAYER_PALETTE, H: NES.lbrown }, // up (show back)
  ];

  for (let dir = 0; dir < 4; dir++) {
    for (let f = 0; f < 3; f++) {
      const frameIdx = dir * 3 + f;
      const ox = frameIdx * FS * SCALE;
      const src = PLAYER_FRAMES.down[f % 3];
      ctx.save();
      ctx.translate(ox, 0);
      // Flip horizontally for left-facing
      if (dir === 1) {
        ctx.translate(FS * SCALE, 0);
        ctx.scale(-1, 1);
      }
      drawGrid(ctx, src, palettes[dir], SCALE);
      ctx.restore();
    }
  }

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
    p: { B: NES.lbrown, b: NES.brown, w: NES.white, '.': null },
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
    p: { L: NES.lpurple, l: NES.lgray, b: NES.black, R: NES.lred, '.': null },
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
    p: { B: NES.green, v: NES.lgreen, V: NES.lyellow, E: NES.lyellow, r: NES.lred, '.': null },
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
    p: { P: NES.white, p: NES.lgray, R: NES.red, m: NES.mgray, '.': null },
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
    const SCALE = 1;
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

  for (let f = 0; f < PORTAL_FRAMES; f++) {
    pctx.save();
    pctx.translate(f * FS * SCALE, 0);
    // Outer ring
    pctx.fillStyle = portalRings[f];
    pctx.fillRect(4 * SCALE, 2 * SCALE, 8 * SCALE, 12 * SCALE);
    pctx.fillRect(2 * SCALE, 4 * SCALE, 12 * SCALE, 8 * SCALE);
    // Inner glow
    pctx.fillStyle = portalColors[f];
    pctx.fillRect(5 * SCALE, 3 * SCALE, 6 * SCALE, 10 * SCALE);
    pctx.fillRect(3 * SCALE, 5 * SCALE, 10 * SCALE, 6 * SCALE);
    // Center
    pctx.fillStyle = NES.white;
    pctx.fillRect(6 * SCALE, 6 * SCALE, 4 * SCALE, 4 * SCALE);
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

  // Heart sprite (8×8, 2 states: full/empty)
  const hc = createCanvas(2 * 8 * SCALE, 8 * SCALE);
  const hctx = hc.getContext('2d');
  [[NES.red, NES.lred], [NES.dgray, NES.mgray]].forEach(([fg, hi], f) => {
    hctx.save();
    hctx.translate(f * 8 * SCALE, 0);
    hctx.fillStyle = fg;
    hctx.fillRect(1 * SCALE, 2 * SCALE, 2 * SCALE, 2 * SCALE);
    hctx.fillRect(5 * SCALE, 2 * SCALE, 2 * SCALE, 2 * SCALE);
    hctx.fillRect(0 * SCALE, 3 * SCALE, 8 * SCALE, 3 * SCALE);
    hctx.fillRect(1 * SCALE, 6 * SCALE, 6 * SCALE, 1 * SCALE);
    hctx.fillRect(2 * SCALE, 7 * SCALE, 4 * SCALE, 1 * SCALE);
    hctx.fillStyle = hi;
    hctx.fillRect(1 * SCALE, 2 * SCALE, 1 * SCALE, 1 * SCALE);
    hctx.fillRect(5 * SCALE, 2 * SCALE, 1 * SCALE, 1 * SCALE);
    hctx.restore();
  });
  addCanvasSpriteSheet(scene, 'heart', hc, 8 * SCALE, 8 * SCALE);

  // XP bar background (128×8)
  const xpW = 128, xpH = 8;
  const xpc = createCanvas(xpW, xpH);
  const xpctx = xpc.getContext('2d');
  xpctx.fillStyle = NES.black;
  xpctx.fillRect(0, 0, xpW, xpH);
  xpctx.fillStyle = NES.dgray;
  xpctx.fillRect(1, 1, xpW - 2, xpH - 2);
  addCanvasTexture(scene, 'xpbar_bg', xpc);

  const xpfc = createCanvas(xpW, xpH);
  const xpfctx = xpfc.getContext('2d');
  xpfctx.fillStyle = NES.lgreen;
  xpfctx.fillRect(0, 0, xpW, xpH);
  xpfctx.fillStyle = NES.green;
  xpfctx.fillRect(0, xpH - 2, xpW, 2);
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
