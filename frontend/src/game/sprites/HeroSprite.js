// The hero: a 16×16 chibi drawn from the kid's avatar (skin, hair colour and
// style, eyes, mouth, shirt, accessory). Front, back and side views with a
// 3-frame walk, plus one broom-swing frame per direction.
//
// Sheet layout (unchanged, see Player.js):
//   0–11  walk  (dir*3 + frame) — dir 0=down, 1=left, 2=right, 3=up
//   12–15 attack (down, left, right, up)

const FS = 16;
const SCALE = 2;

// Legend: R hair, r hair shade, S skin, s skin shade, E eye, M mouth,
// T shirt, t shirt shade, W shirt light, b belt, P pants, K boots,
// A broom handle, a bristles
const HEAD_FRONT = [
  '.....RRRRRR.....',
  '....RRRRRRRR....',
  '...RRRRRRRRRR...',
  '...RRSSSSSSRR...',
  '...RSSSSSSSSR...',
  '...RSESSSSESR...',
  '....SESSSSES....',
  '....SSSMMSSS....',
  '.....ssSSss.....',
];
const HEAD_BACK = [
  '.....RRRRRR.....',
  '....RRRRRRRR....',
  '...RRRRRRRRRR...',
  '...RRRRRRRRRR...',
  '...RRrRRRRrRR...',
  '...RRRRRRRRRR...',
  '....RRrRRrRR....',
  '....SRRRRRRS....',
  '.....ssSSss.....',
];
const HEAD_SIDE = [
  '.....RRRRRR.....',
  '....RRRRRRRR....',
  '...RRRRRRRRRR...',
  '...RRRRSSSSSS...',
  '...RRRSSSSSSS...',
  '...RRRSSSSESS...',
  '...RRrSSSSESS...',
  '....RRSSSSSMS...',
  '.....sSSSSs.....',
];

const BODY_FRONT = [
  '..TTWWTTTTTTTT..',
  '..STTTTTTTTTTS..',
  '..SbbbbbbbbbbS..',
  '...PPPPPPPPPP...',
];
const BODY_BACK = [
  '..TTTTTTTTTTTT..',
  '..STTTtTTtTTTS..',
  '..SbbbbbbbbbbS..',
  '...PPPPPPPPPP...',
];
const BODY_SIDE = [
  '....TTTTTTTT....',
  '....TTTSTTTT....',
  '....bbbSbbbb....',
  '....PPPPPPPP....',
];

const LEGS_FRONT = [
  ['...PPP....PPP...', '...KKK....KKK...', '................'],  // stand
  ['...PPP....PPP...', '..KKKK....PPP...', '..........KKK...'],  // step left
  ['...PPP....PPP...', '...PPP....KKKK..', '...KKK..........'],  // step right
];
const LEGS_SIDE = [
  ['....PPP..PPP....', '....KKKK.KKKK...', '................'],
  ['...PPP...PPP....', '..KKKK...KKKK...', '................'],
  ['.....PPPP.......', '.....KKKKK......', '................'],
];

const HAIR_GROUPS = {
  short: ['short', 'side_part', 'fade', 'buzz', 'undercut', 'wavy'],
  long: ['long', 'shoulder', 'bob', 'braids', 'dreadlocks'],
  spiky: ['spiky', 'mohawk'],
  big: ['afro', 'curly'],
  tied: ['ponytail', 'bun', 'twin_buns', 'pigtails'],
  none: ['none'],
};
function hairGroup(style) {
  for (const [group, styles] of Object.entries(HAIR_GROUPS)) {
    if (styles.includes(style)) return group;
  }
  return 'short';
}

const toRows = (rows) => rows.map((r) => [...r]);
const setPx = (g, y, x, ch) => { if (g[y] && x >= 0 && x < FS) g[y][x] = ch; };

function applyHair(g, view, group) {
  if (group === 'none') {
    for (const row of g) for (let x = 0; x < FS; x++) {
      if (row[x] === 'R' || row[x] === 'r') row[x] = row[x] === 'R' ? 'S' : 's';
    }
    return;
  }
  if (group === 'spiky') {
    g[0] = [...'....R.RR.RR.R...'];
  }
  if (group === 'big') {
    for (let y = 1; y <= 6; y++) {
      const first = g[y].indexOf('R');
      const last = g[y].lastIndexOf('R');
      if (first > 0) setPx(g, y, first - 1, 'R');
      if (last >= 0) setPx(g, y, last + 1, 'R');
    }
    g[0] = [...'....RRRRRRRR....'];
  }
  if (group === 'long') {
    const sides = view === 'side' ? [3, 4] : [3, 12];
    for (let y = 6; y <= 10; y++) sides.forEach((x) => setPx(g, y, x, y === 10 ? 'r' : 'R'));
    if (view === 'back') for (let y = 7; y <= 10; y++) for (let x = 4; x <= 11; x++) setPx(g, y, x, y === 10 ? 'r' : 'R');
  }
  if (group === 'tied') {
    if (view === 'back') { [7, 8, 9].forEach((y) => { setPx(g, y, 7, 'R'); setPx(g, y, 8, 'R'); }); setPx(g, 10, 7, 'r'); }
    else if (view === 'side') { [4, 5, 6, 7].forEach((y) => setPx(g, y, 2, y === 7 ? 'r' : 'R')); }
    else { setPx(g, 4, 2, 'R'); setPx(g, 5, 2, 'R'); setPx(g, 4, 13, 'R'); setPx(g, 5, 13, 'R'); }
  }
}

function frame(view, walk, group) {
  const head = view === 'back' ? HEAD_BACK : view === 'side' ? HEAD_SIDE : HEAD_FRONT;
  const body = view === 'back' ? BODY_BACK : view === 'side' ? BODY_SIDE : BODY_FRONT;
  const legs = (view === 'side' ? LEGS_SIDE : LEGS_FRONT)[walk];
  const g = toRows([...head, ...body, ...legs]);
  applyHair(g, view, group);
  return g;
}

// Broom pixels for the attack pose, per facing
function addBroom(g, dir) {
  const A = (y, x) => setPx(g, y, x, 'A');
  const a = (y, x) => setPx(g, y, x, 'a');
  if (dir === 'down') {
    [10, 11, 12, 13].forEach((y) => A(y, 14));
    [14, 15].forEach((y) => { a(y, 13); a(y, 14); a(y, 15); });
  } else if (dir === 'up') {
    [3, 4, 5, 6, 7, 8, 9].forEach((y) => A(y, 14));
    [0, 1, 2].forEach((y) => { a(y, 13); a(y, 14); a(y, 15); });
  } else { // side (right; left is mirrored)
    [11, 12, 13].forEach((x) => A(10, x));
    [9, 10, 11].forEach((y) => { a(y, 14); a(y, 15); });
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 255) + amt), b = clamp((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
function hexOr(raw, fallback) {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw.trim()) ? raw.trim() : fallback;
}

export function heroPalette(avatar = {}) {
  const skin = hexOr(avatar?.head_color, '#f6c9a0');
  const hair = hexOr(avatar?.hair_color, '#6b4423');
  const shirt = hexOr(avatar?.body_color, '#4caf50');
  return {
    R: hair, r: shade(hair, -28),
    S: skin, s: shade(skin, -26),
    E: hexOr(avatar?.eye_color, '#2b1d14'),
    M: hexOr(avatar?.mouth_color, '#c0504d'),
    T: shirt, t: shade(shirt, -26), W: shade(shirt, 30),
    b: hexOr(avatar?.accessory_color || avatar?.hat_color, '#f2c14e'),
    P: '#3d4b6e',
    K: '#6b4a2b',
    A: '#a8794a', a: '#f2d16b',
    '.': null,
  };
}

/**
 * Draw the hero sheet onto ctx (16 frames of 32×32).
 * drawOutlined(ctx, grid, palette, scale) is the shared outline-aware painter.
 */
export function drawHeroSheet(ctx, avatar, drawOutlined) {
  const pal = heroPalette(avatar);
  const group = hairGroup(avatar?.hair || avatar?.hair_style || 'short');
  const views = ['front', 'side', 'side', 'back'];          // down, left, right, up
  const put = (index, grid, flip) => {
    ctx.save();
    ctx.translate(index * FS * SCALE, 0);
    if (flip) { ctx.translate(FS * SCALE, 0); ctx.scale(-1, 1); }
    drawOutlined(ctx, grid.map((r) => r.join('')), pal, SCALE);
    ctx.restore();
  };
  // Side frames are authored facing right; "left" (dir 1) is the mirror.
  views.forEach((view, dir) => {
    for (let f = 0; f < 3; f++) put(dir * 3 + f, frame(view, f, group), dir === 1);
  });
  [['down', 'front', false], ['left', 'side', true], ['right', 'side', false], ['up', 'back', false]]
    .forEach(([dir, view, flip], i) => {
      const g = frame(view, 0, group);
      addBroom(g, dir === 'left' || dir === 'right' ? 'side' : dir);
      put(12 + i, g, flip);
    });
}

export const HERO_SHEET = { frames: 16, frameSize: FS * SCALE };
