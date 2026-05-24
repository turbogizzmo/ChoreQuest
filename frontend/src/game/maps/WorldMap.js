// Builds the world tilemap from the procedural grid in WorldData.

import { buildBaseMap, TILE, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../data/WorldData.js';

const TILE_NAMES = ['grass','dirt','water','path','tree_top','tree_bot','wall','flower'];

export function buildWorldTilemap(scene) {
  const grid = buildBaseMap();

  // Convert enum grid to Phaser tilemap data (1-indexed, 0=empty)
  const mapData = grid.map(row => row.map(t => t + 1));

  const map = scene.make.tilemap({
    data:       mapData,
    tileWidth:  TILE_SIZE,
    tileHeight: TILE_SIZE,
    width:      MAP_COLS,
    height:     MAP_ROWS,
  });

  const tiles = map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, 0, 0);
  const layer = map.createLayer(0, tiles, 0, 0);
  layer.setDepth(0);

  // Collision tiles: water (3), tree_top (5), wall (7) — 1-indexed
  map.setCollision([TILE.WATER + 1, TILE.TREE_TOP + 1, TILE.WALL + 1]);

  // World bounds
  scene.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
  scene.cameras.main.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

  return { map, layer };
}
