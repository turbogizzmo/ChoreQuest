// Builds the world tilemap from the procedural grid in WorldData.

import { buildBaseMap, TILE, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../data/WorldData.js';

const TILE_NAMES = ['grass','dirt','water','path','tree_top','tree_bot','wall','flower'];

export function buildWorldTilemap(scene) {
  const grid = buildBaseMap();

  // TILE enum values are used directly as tile indices: the tileset is added
  // with the default firstgid of 0, so data value N renders tileset frame N.
  const map = scene.make.tilemap({
    data:       grid,
    tileWidth:  TILE_SIZE,
    tileHeight: TILE_SIZE,
    width:      MAP_COLS,
    height:     MAP_ROWS,
  });

  const tiles = map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, 0, 0);
  const layer = map.createLayer(0, tiles, 0, 0);
  layer.setDepth(0);

  // Collision tiles: water, tree_top, wall
  map.setCollision([TILE.WATER, TILE.TREE_TOP, TILE.WALL]);

  // World bounds
  scene.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
  scene.cameras.main.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

  return { map, layer };
}
