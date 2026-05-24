// World map layout and chore portal definitions.
// Tile indices: 0=grass, 1=dirt, 2=water, 3=path, 4=tree_top, 5=tree_bot, 6=wall, 7=flower

export const TILE = {
  GRASS: 0,
  DIRT:  1,
  WATER: 2,
  PATH:  3,
  TREE_TOP: 4,
  TREE_BOT: 5,
  WALL:  6,
  FLOWER: 7,
};

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
    buildingKey: 'building_kitchen',
    color: 0xff6644,
    choreCategories: ['Kitchen'],
    description: 'Culinary quests await inside!',
  },
  {
    id: 'laundry',
    label: 'Laundry Hut',
    x: 28, y: 8,
    buildingKey: 'building_laundry',
    color: 0x6688ff,
    choreCategories: ['Laundry', 'Bedroom'],
    description: 'Tame the wild laundry beasts!',
  },
  {
    id: 'yard',
    label: 'Yard Entrance',
    x: 10, y: 28,
    buildingKey: null,
    color: 0x44cc44,
    choreCategories: ['Garden', 'Pets', 'Outdoor'],
    description: 'The wild outdoors beckons.',
  },
  {
    id: 'study',
    label: 'Study Hall',
    x: 28, y: 28,
    buildingKey: null,
    color: 0xffcc00,
    choreCategories: ['Homework'],
    description: 'Knowledge is power!',
  },
  {
    id: 'castle',
    label: 'Reward Castle',
    x: 19, y: 18,
    buildingKey: 'building_reward_castle',
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

// Build the base tile grid (40x40)
export function buildBaseMap() {
  const grid = [];

  for (let row = 0; row < MAP_ROWS; row++) {
    grid[row] = [];
    for (let col = 0; col < MAP_COLS; col++) {
      // Default: grass
      grid[row][col] = TILE.GRASS;
    }
  }

  // Water border (top/bottom)
  for (let col = 0; col < MAP_COLS; col++) {
    grid[0][col] = TILE.WATER;
    grid[1][col] = TILE.WATER;
    grid[MAP_ROWS - 1][col] = TILE.WATER;
    grid[MAP_ROWS - 2][col] = TILE.WATER;
  }
  // Water border (left/right)
  for (let row = 0; row < MAP_ROWS; row++) {
    grid[row][0] = TILE.WATER;
    grid[row][1] = TILE.WATER;
    grid[row][MAP_COLS - 1] = TILE.WATER;
    grid[row][MAP_COLS - 2] = TILE.WATER;
  }

  // Main cross paths
  const midCol = Math.floor(MAP_COLS / 2);
  const midRow = Math.floor(MAP_ROWS / 2);
  for (let r = 2; r < MAP_ROWS - 2; r++) {
    grid[r][midCol]     = TILE.PATH;
    grid[r][midCol - 1] = TILE.PATH;
  }
  for (let c = 2; c < MAP_COLS - 2; c++) {
    grid[midRow][c]     = TILE.PATH;
    grid[midRow - 1][c] = TILE.PATH;
  }

  // Scatter some flowers
  const flowerPositions = [
    [5,5],[5,34],[34,5],[34,34],
    [8,15],[15,8],[8,24],[24,8],
    [31,15],[15,31],[31,24],[24,31],
  ];
  flowerPositions.forEach(([r, c]) => { grid[r][c] = TILE.FLOWER; });

  // Tree clusters (corners — kept away from portals)
  [[4,4],[4,5],[4,6],[5,6],[6,5],[3,5]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });
  [[4,33],[4,34],[4,35],[5,33],[6,34],[3,34]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });
  [[34,4],[34,5],[35,4],[35,5],[33,6],[36,5]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });
  [[34,33],[34,34],[35,33],[35,34],[33,33],[36,34]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });
  // Extra trees along top/bottom edges
  [[3,12],[3,13],[3,25],[3,26]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });
  [[36,12],[36,13],[36,25],[36,26]].forEach(([r,c]) => { grid[r][c] = TILE.TREE_TOP; });

  // ── Branch paths leading from main cross to each portal ──────────────────
  // Players need clear roads; without these the map is a featureless grass field.

  // Kitchen (col 10, row 8): horizontal branch west from vertical path
  for (let c = 9; c <= 20; c++) { grid[8][c] = TILE.PATH; grid[9][c] = TILE.PATH; }

  // Laundry (col 28, row 8): horizontal branch east from vertical path
  for (let c = 19; c <= 29; c++) { grid[8][c] = TILE.PATH; grid[9][c] = TILE.PATH; }

  // Yard (col 10, row 28): horizontal branch west from vertical path
  for (let c = 9; c <= 20; c++) { grid[28][c] = TILE.PATH; grid[29][c] = TILE.PATH; }

  // Study (col 28, row 28): horizontal branch east from vertical path
  for (let c = 19; c <= 29; c++) { grid[28][c] = TILE.PATH; grid[29][c] = TILE.PATH; }

  // Flower markers at each portal destination (visual landmark)
  [[7,9],[7,10],[10,6],[11,6]].forEach(([r,c]) => {         // Kitchen
    if (grid[r][c] === TILE.GRASS) grid[r][c] = TILE.FLOWER;
  });
  [[7,29],[7,28],[10,33],[11,33]].forEach(([r,c]) => {      // Laundry
    if (grid[r][c] === TILE.GRASS) grid[r][c] = TILE.FLOWER;
  });
  [[30,9],[30,10],[28,6],[27,6]].forEach(([r,c]) => {       // Yard
    if (grid[r][c] === TILE.GRASS) grid[r][c] = TILE.FLOWER;
  });
  [[30,29],[30,28],[28,33],[27,33]].forEach(([r,c]) => {    // Study
    if (grid[r][c] === TILE.GRASS) grid[r][c] = TILE.FLOWER;
  });

  return grid;
}
