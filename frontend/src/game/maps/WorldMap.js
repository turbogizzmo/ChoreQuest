// Builds the world tilemap from the procedural grid in WorldData.

import { buildBaseMap, COLLIDING_TILES, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../data/WorldData.js';

export function buildWorldTilemap(scene) {
  const grid = buildBaseMap();
  scene.worldGrid = grid; // read by the HUD mini-map

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
  // The tile layer is logic only (collision); the visible ground is painted
  // separately by WorldArt.paintGround.
  layer.setVisible(false);

  map.setCollision(COLLIDING_TILES);

  // World bounds
  scene.physics.world.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
  scene.cameras.main.setBounds(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);

  return { map, layer };
}
