// Raster overlays drawn on a canvas and handed to MapLibre as image sources,
// plus GeoJSON builders. Equirectangular grids are resampled row-by-row into
// Web Mercator so cells line up with the basemap at every latitude (an image
// source is stretched linearly in mercator space, which would misplace rows
// of a lat/lon grid over a tall theater).
import type { TheaterInfo } from '../engine/protocol';
import { GRID_H, GRID_RES, GRID_W, TERRAIN_CLASSES } from '../engine/terrainClasses';
import type { TerrainClass } from '../types/schema';
import type { Feature, FeatureCollection } from 'geojson';

export type Coords4 = [[number, number], [number, number], [number, number], [number, number]];

const MAX_LAT = 85.0;
const clampLat = (l: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, l));
const mY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360));
const invMY = (y: number) => (Math.atan(Math.exp(y)) - Math.PI / 4) * (360 / Math.PI);

/** Generic resampler: value(c, r) -> RGBA (packed into out). */
function resample(
  cols: number, rows: number, west: number, north: number, cellDeg: number,
  paint: (c: number, r: number, px: Uint8ClampedArray, o: number) => void,
): { canvas: HTMLCanvasElement; coords: Coords4 } {
  const latTop = clampLat(north);
  const latBot = clampLat(north - rows * cellDeg);
  const east = west + cols * cellDeg;
  const W = Math.max(1, Math.min(4096, cols));
  const H = Math.max(1, Math.min(4096, rows * 2));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const yTop = mY(latTop), yBot = mY(latBot);
  for (let j = 0; j < H; j++) {
    const lat = invMY(yTop + ((j + 0.5) / H) * (yBot - yTop));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((north - lat) / cellDeg)));
    for (let i = 0; i < W; i++) {
      const c = Math.min(cols - 1, Math.floor(((i + 0.5) / W) * cols));
      paint(c, r, img.data, (j * W + i) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, coords: [[west, latTop], [east, latTop], [east, latBot], [west, latBot]] };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Territory control: 0/1 side colour, 255 (or anything else) transparent. */
export function controlImage(control: Uint8Array, th: TheaterInfo, colors: [string, string]) {
  const c0 = rgb(colors[0]), c1 = rgb(colors[1]);
  return resample(th.cols, th.rows, th.bbox[0], th.bbox[3], th.cellDeg, (c, r, px, o) => {
    const v = control[r * th.cols + c];
    const col = v === 0 ? c0 : v === 1 ? c1 : null;
    if (!col) { px[o + 3] = 0; return; }
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
  });
}

export const TERRAIN_COLORS: Record<TerrainClass, string> = {
  water: '#1d3b5c', plains: '#b7c97a', cropland: '#e3d27a', forest: '#2f6b3a', hills: '#a58a5a',
  mountains: '#7a6a5e', desert: '#e6c48f', steppe: '#c9b979', wetland: '#5aa19a', urban: '#d0504a', ice: '#e8f1f5',
};

/** The engine's own 0.25 degree terrain classes over a bbox: shows what the model "sees". */
export function terrainImage(classes: Uint8Array, bbox: [number, number, number, number]) {
  const [w, s, e, n] = bbox;
  const c0 = Math.max(0, Math.floor((w + 180) / GRID_RES));
  const c1 = Math.min(GRID_W, Math.ceil((e + 180) / GRID_RES));
  const r0 = Math.max(0, Math.floor((90 - n) / GRID_RES));
  const r1 = Math.min(GRID_H, Math.ceil((90 - s) / GRID_RES));
  const pal = TERRAIN_CLASSES.map((k) => rgb(TERRAIN_COLORS[k]));
  return resample(c1 - c0, r1 - r0, -180 + c0 * GRID_RES, 90 - r0 * GRID_RES, GRID_RES, (c, r, px, o) => {
    const k = classes[(r0 + r) * GRID_W + c0 + c];
    if (k === 0 || k >= pal.length) { px[o + 3] = 0; return; }
    const col = pal[k];
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
  });
}

type FC = FeatureCollection;

export function bboxFeature(b: [number, number, number, number] | null): FC {
  if (!b) return { type: 'FeatureCollection', features: [] };
  const [w, s, e, n] = b;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } }],
  };
}

export function supplyFeatures(lines: [number[][], number[][]] | undefined, colors: [string, string]): FC {
  const features: Feature[] = [];
  if (lines) {
    lines.forEach((side, si) => {
      for (const flat of side) {
        const coords: number[][] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) coords.push([flat[i], flat[i + 1]]);
        if (coords.length >= 2) features.push({ type: 'Feature', properties: { color: colors[si] }, geometry: { type: 'LineString', coordinates: coords } });
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

export function pointFeatures(pts: { lat: number; lon: number; color: string; label?: string }[]): FC {
  return {
    type: 'FeatureCollection',
    features: pts.map((p) => ({ type: 'Feature', properties: { color: p.color, label: p.label ?? '' }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  };
}

/** Rough label anchor: bbox centre of the largest polygon by vertex count. */
export function labelPoint(mp: number[][][][]): [number, number] | null {
  let best: number[][] | null = null;
  for (const poly of mp) if (poly[0] && (!best || poly[0].length > best.length)) best = poly[0];
  if (!best || best.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of best) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [(w + e) / 2, (s + n) / 2];
}
