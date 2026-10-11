// World map layout and chore portal definitions.
// Tile indices are logic types (collision, mini-map); see buildBaseMap below.

export const TILE = {
  GRASS: 0,
  DIRT:  1,
  WATER: 2,
  PATH:  3,
  TREE_TOP: 4,
  TREE_BOT: 5,
  WALL:  6,
  FLOWER: 7,
  SAND:  8,
  STONE: 9,   // castle plaza paving
  BUSH:  10,
  ROCK:  11,
};
// TREE_BOT marks a tree trunk (collides); WALL marks a building footprint.
export const COLLIDING_TILES = [TILE.WATER, TILE.TREE_TOP, TILE.TREE_BOT, TILE.WALL, TILE.BUSH, TILE.ROCK];

export const MAP_COLS = 40;
export const MAP_ROWS = 40;
export const TILE_SIZE = 32;

// Portal zone categories — map to ChoreQuest chore categories
// choreCategories must match the seeded category names in backend/seed.py:
// Kitchen, Bedroom, Bathroom, Garden, Pets, Homework, Laundry, General, Outdoor
export const PORTAL_ZONES = [
  {
    id: 'kitchen',
    label: 'Kitchen District',
    x: 10, y: 8,
    building: 'kitchen',
    color: 0xff6644,
    choreCategories: ['Kitchen'],
    description: 'Culinary quests await inside!',
  },
  {
    id: 'laundry',
    label: 'Laundry Hut',
    x: 28, y: 8,
    building: 'laundry',
    color: 0x6688ff,
    choreCategories: ['Laundry', 'Bedroom'],
    description: 'Tame the wild laundry beasts!',
  },
  {
    id: 'yard',
    label: 'Yard Entrance',
    x: 10, y: 28,
    building: 'greenhouse',
    color: 0x44cc44,
    choreCategories: ['Garden', 'Pets', 'Outdoor'],
    description: 'The wild outdoors beckons.',
  },
  {
    id: 'study',
    label: 'Study Hall',
    x: 28, y: 28,
    building: 'library',
    color: 0xffcc00,
    choreCategories: ['Homework'],
    description: 'Knowledge is power!',
  },
  {
    id: 'castle',
    label: 'Reward Castle',
    x: 19, y: 18,
    building: 'castle',
    color: 0xffdd00,
    choreCategories: [],
    description: 'Redeem your hard-earned rewards!',
    isRewardShop: true,
  },
];

// Enemy spawn zones
export const ENEMY_ZONES = [
  { type: 'dust_bunny',      x: 6,  y: 15, count: 2 },
  { type: 'dust_bunny',      x: 33, y: 15, count: 2 },
  { type: 'sock_goblin',     x: 6,  y: 22, count: 2 },
  { type: 'sock_goblin',     x: 33, y: 22, count: 2 },
  { type: 'crumb_slime',     x: 18, y: 6,  count: 2 },
  { type: 'crumb_slime',     x: 18, y: 32, count: 2 },
  // Phase 5-A: two new enemy types
  { type: 'mop_golem',       x: 14, y: 14, count: 2 },
  { type: 'mop_golem',       x: 25, y: 25, count: 2 },
  { type: 'trash_bag_ghost', x: 25, y: 14, count: 2 },
  { type: 'trash_bag_ghost', x: 14, y: 25, count: 2 },
];

export const ENEMY_STATS = {
  dust_bunny:      { hp: 8,  xp: 2, coins: 1, name: 'Dust Bunny',      speed: 60 },
  sock_goblin:     { hp: 12, xp: 3, coins: 2, name: 'Sock Goblin',     speed: 50 },
  crumb_slime:     { hp: 6,  xp: 1, coins: 1, name: 'Crumb Slime',     speed: 40 },
  // Phase 5-A: new enemies
  mop_golem:       { hp: 18, xp: 5, coins: 3, name: 'Mop Golem',       speed: 32 },
  trash_bag_ghost: { hp: 9,  xp: 4, coins: 2, name: 'Trash Bag Ghost', speed: 80 },
};

// Weapons / attacks
export const WEAPON_STATS = {
  broom:   { damage: 3, range: 72,  cooldown: 500,  name: 'Broom Swipe' },
  vacuum:  { damage: 4, range: 88,  cooldown: 800,  name: 'Vacuum Blast' },
  soap:    { damage: 5, range: 56,  cooldown: 1000, name: 'Soap Attack' },
  sponge:  { damage: 2, range: 120, cooldown: 600,  name: 'Toss Sponge' },
};

// Boss enemies — one per portal zone, respawn every 24 hours.
// bossDefeats in save: { type: timestamp_ms }
export const BOSS_ZONES = [
  { type: 'grime_lord',   x: 12, y: 12, portalId: 'kitchen', label: 'Grime Lord'   },
  { type: 'lint_titan',   x: 27, y: 12, portalId: 'laundry', label: 'Lint Titan'   },
  { type: 'weed_golem',   x: 12, y: 27, portalId: 'yard',    label: 'Weed Golem'   },
  { type: 'paper_wraith', x: 27, y: 27, portalId: 'study',   label: 'Paper Wraith' },
];

export const BOSS_STATS = {
  grime_lord:   { hp: 24, xp: 15, coins: 8,  name: 'Grime Lord',   speed: 52 },
  lint_titan:   { hp: 30, xp: 18, coins: 10, name: 'Lint Titan',   speed: 44 },
  weed_golem:   { hp: 20, xp: 12, coins: 7,  name: 'Weed Golem',   speed: 58 },
  paper_wraith: { hp: 18, xp: 10, coins: 6,  name: 'Paper Wraith', speed: 68 },
};

// Weapon upgrade shop items — sold in the Reward Castle portal.
export const WEAPON_UPGRADES = [
  { weapon: 'vacuum', cost: 20, name: 'Vacuum Blast', desc: 'More damage, longer range' },
  { weapon: 'sponge', cost: 35, name: 'Toss Sponge',  desc: 'Wide-range area throw'     },
  { weapon: 'soap',   cost: 60, name: 'Soap Attack',  desc: 'Highest single-hit damage'  },
];

// Chest loot drops — 20% chance on enemy defeat
export const CHEST_DROP_CHANCE = 0.20;
export const CHEST_REWARDS = [
  { coins: 2, xp: 3 },
  { coins: 3, xp: 4 },
  { coins: 5, xp: 5 },
  { coins: 4, xp: 8 },
  { coins: 6, xp: 6 },
];

// Chore Surge world event — fires every SURGE_INTERVAL ms, lasts SURGE_DURATION ms
export const SURGE_INTERVAL = 8 * 60 * 1000;  // 8 minutes between surges
export const SURGE_DURATION = 90 * 1000;       // 90-second surge window
export const SURGE_XP_MULT  = 2;               // 2× XP during surge

// XP table: level -> xp needed to reach NEXT level
export function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.4, level - 1));
}

export function levelFromXp(xp) {
  let lvl = 1;
  let accumulated = 0;
  while (accumulated + xpForLevel(lvl) <= xp) {
    accumulated += xpForLevel(lvl);
    lvl++;
    if (lvl > 99) break;
  }
  return lvl;
}

// ── World layout ──────────────────────────────────────────────────────────────
// The grid is the game's logic layer: collision, mini-map and enemy spawning
// all read it. What the player sees is painted from it (GroundPainter for the
// ground, sprites for trees/bushes/rocks/buildings).

// Buildings sit directly behind their portal, which marks the doorway.
// col/row = top-left tile of the footprint; w/h in tiles.
export const BUILDINGS = PORTAL_ZONES
  .filter((z) => z.building)
  .map((z) => {
    const w = z.isRewardShop ? 5 : 3;
    const h = 4;
    return { id: z.id, style: z.building, col: z.x - Math.floor(w / 2), row: z.y - h, w, h, color: z.color };
  });

// Deterministic per-tile hash (0..1) so the world looks the same every visit.
export function tileHash(r, c, salt = 0) {
  let h = (r * 374761393 + c * 668265263 + salt * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function buildBaseMap() {
  const grid = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(TILE.GRASS));
  const inBounds = (r, c) => r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS;
  const set = (r, c, t) => { if (inBounds(r, c)) grid[r][c] = t; };
  const fill = (r0, c0, r1, c1, t) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(r, c, t);
  };

  // ── Coast: 2-tile water ring with an irregular inner edge ────────────────
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const d = Math.min(r, c, MAP_ROWS - 1 - r, MAP_COLS - 1 - c);
      if (d <= 1) grid[r][c] = TILE.WATER;
      else if (d === 2 && tileHash(r, c, 1) < 0.35) grid[r][c] = TILE.WATER;
    }
  }

  // ── Roads ────────────────────────────────────────────────────────────────
  const midCol = Math.floor(MAP_COLS / 2);   // 20 → road on cols 19–20
  const midRow = Math.floor(MAP_ROWS / 2);   // 20 → road on rows 19–20
  fill(4, midCol - 1, MAP_ROWS - 5, midCol, TILE.PATH);
  fill(midRow - 1, 4, midRow, MAP_COLS - 5, TILE.PATH);

  // Stone plaza around the Reward Castle (the castle footprint is set below)
  fill(13, 16, 21, 23, TILE.STONE);

  // Branch roads from the main road to each district door
  PORTAL_ZONES.filter((z) => !z.isRewardShop).forEach((z) => {
    const [c0, c1] = z.x < midCol ? [z.x - 1, midCol - 1] : [midCol, z.x + 1];
    fill(z.y, c0, z.y + 1, c1, TILE.PATH);
  });

  // ── Pond (south-west, between the Yard and the castle) ──────────────────
  for (let r = 30; r <= 35; r++) {
    for (let c = 11; c <= 18; c++) {
      // Slightly wide ellipse with a wobbly rim so it reads as a natural pond
      const dy = (r - 32.5) / 2.7;
      const dx = (c - 14.5) / 3.6;
      const wobble = (tileHash(r, c, 8) - 0.5) * 0.35;
      if (dx * dx + dy * dy <= 1 + wobble) grid[r][c] = TILE.WATER;
    }
  }

  // ── Buildings (collide like walls) ──────────────────────────────────────
  BUILDINGS.forEach((b) => fill(b.row, b.col, b.row + b.h - 1, b.col + b.w - 1, TILE.WALL));

  // ── Sand wherever land touches water ────────────────────────────────────
  const isWater = (r, c) => inBounds(r, c) && grid[r][c] === TILE.WATER;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r][c] !== TILE.GRASS) continue;
      for (let dr = -1; dr <= 1 && grid[r][c] === TILE.GRASS; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if ((dr || dc) && isWater(r + dr, c + dc)) { grid[r][c] = TILE.SAND; break; }
        }
      }
    }
  }

  // ── Keep-clear zones for scenery: roads, doors, spawns, NPC ─────────────
  const blocked = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(false));
  const block = (r, c, rad) => {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (inBounds(r + dr, c + dc)) blocked[r + dr][c + dc] = true;
    }
  };
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const t = grid[r][c];
      if (t === TILE.PATH || t === TILE.STONE || t === TILE.WALL) block(r, c, 1);
    }
  }
  PORTAL_ZONES.forEach((z) => block(z.y, z.x, 2));
  ENEMY_ZONES.forEach((z) => block(z.y, z.x, 2));
  BOSS_ZONES.forEach((z) => block(z.y, z.x, 2));
  block(17, 23, 1);                                         // NPC shopkeeper
  [[7, 7], [7, 33], [33, 7], [33, 33]].forEach(([r, c]) => block(r, c, 1)); // respawn points

  const canDecorate = (r, c) => inBounds(r, c) && grid[r][c] === TILE.GRASS && !blocked[r][c];

  // ── Trees: dense along the coast, scattered groves inland ──────────────
  for (let r = 3; r < MAP_ROWS - 3; r++) {
    for (let c = 3; c < MAP_COLS - 3; c++) {
      if (!canDecorate(r, c)) continue;
      const d = Math.min(r, c, MAP_ROWS - 1 - r, MAP_COLS - 1 - c);
      // Groves: coarse 4×4-tile cells, some of which get dense tree cover
      const grove = tileHash(r >> 2, c >> 2, 7) < 0.32;
      const chance = d <= 4 ? 0.55 : grove ? 0.4 : 0.04;
      // A trunk needs the tile above free for its canopy; canopies may overlap sideways
      if (tileHash(r, c, 2) < chance && grid[r - 1][c] !== TILE.TREE_BOT) {
        grid[r][c] = TILE.TREE_BOT;
      }
    }
  }

  // ── Bushes, rocks and flower beds ──────────────────────────────────────
  for (let r = 3; r < MAP_ROWS - 3; r++) {
    for (let c = 3; c < MAP_COLS - 3; c++) {
      if (!canDecorate(r, c)) continue;
      const roll = tileHash(r, c, 3);
      if (roll < 0.035) grid[r][c] = TILE.BUSH;
      else if (roll < 0.05) grid[r][c] = TILE.ROCK;
      else if (roll < 0.11) grid[r][c] = TILE.FLOWER;
    }
  }

  // Flower beds either side of each district door
  PORTAL_ZONES.filter((z) => !z.isRewardShop).forEach((z) => {
    [[z.y - 1, z.x - 2], [z.y - 1, z.x + 2], [z.y - 2, z.x - 2], [z.y - 2, z.x + 2]].forEach(([r, c]) => {
      if (inBounds(r, c) && grid[r][c] === TILE.GRASS) grid[r][c] = TILE.FLOWER;
    });
  });

  return grid;
}
