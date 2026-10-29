// Terrain class indices as stored in public/data/terrain/grid.bin. Shared by the
// pipeline (writer), the engine and the map (readers). Order is part of the file format.
import type { TerrainClass } from '../types/mechanics';

export const TERRAIN_CLASSES: TerrainClass[] = [
  'water', 'plains', 'cropland', 'forest', 'hills', 'mountains',
  'desert', 'steppe', 'wetland', 'urban', 'ice',
];

export const T = Object.fromEntries(TERRAIN_CLASSES.map((c, i) => [c, i])) as Record<TerrainClass, number>;

/** Grid geometry: 0.25 degree equirectangular, row 0 is the northernmost band. */
export const GRID_RES = 0.25;
export const GRID_W = 1440;
export const GRID_H = 720;

/** Bit flags in the flags byte. */
export const FLAG_RIVER = 1;   // a Natural Earth major river crosses the cell
export const FLAG_COAST = 2;   // land cell adjacent to sea

export function cellIndex(lat: number, lon: number): number {
  const row = Math.min(GRID_H - 1, Math.max(0, Math.floor((90 - lat) / GRID_RES)));
  let col = Math.floor((lon + 180) / GRID_RES) % GRID_W;
  if (col < 0) col += GRID_W;
  return row * GRID_W + col;
}

export function cellCenter(idx: number): { lat: number; lon: number } {
  const row = Math.floor(idx / GRID_W);
  const col = idx % GRID_W;
  return { lat: 90 - (row + 0.5) * GRID_RES, lon: -180 + (col + 0.5) * GRID_RES };
}
