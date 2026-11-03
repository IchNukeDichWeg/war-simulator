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

/** Front line: the boundary between side-0 and side-1 cells of the control grid
 *  (neutral and sea cells are not front). Marching squares on cell centres, so
 *  the line runs diagonally through mixed blocks instead of stair-stepping
 *  along cell edges; segments are chained and Chaikin-smoothed twice. Every
 *  line is oriented with side 0 on its LEFT, so a negative line-offset puts a
 *  stroke on side 0's side and a positive one on side 1's. */
export function frontFeatures(control: Uint8Array, th: TheaterInfo): FC {
  const { cols, rows, cellDeg } = th;
  const west = th.bbox[0], north = th.bbox[3];
  // points in half-cell units: cell (r, c) centre = (2r+1, 2c+1); key = y * K + x
  const K = 2 * cols + 4;
  const segs: number[] = []; // flat [fromKey, toKey]
  const at = (r: number, c: number) => control[r * cols + c];
  const cross = (px: number, py: number, qx: number, qy: number, sx: number, sy: number) =>
    // y grows southward in grid units, so flip it to get the geographic left
    (qx - px) * (-(sy - py)) - (-(qy - py)) * (sx - px);
  const emit = (p: number, q: number, s: number) => {
    const px = p % K, py = (p / K) | 0, qx = q % K, qy = (q / K) | 0, sx = s % K, sy = (s / K) | 0;
    if (cross(px, py, qx, qy, sx, sy) > 0) segs.push(p, q); else segs.push(q, p);
  };
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const v = [at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c)]; // TL TR BR BL
      if (v.every((x) => x === v[0])) continue;
      // corner positions (half-cell units) in the same order
      const cy = [2 * r + 1, 2 * r + 1, 2 * r + 3, 2 * r + 3];
      const cx = [2 * c + 1, 2 * c + 3, 2 * c + 3, 2 * c + 1];
      const mids: number[] = [], own0: number[] = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) & 3];
        if (!((a === 0 && b === 1) || (a === 1 && b === 0))) continue;
        const n = (e + 1) & 3;
        mids.push(((cy[e] + cy[n]) / 2) * K + (cx[e] + cx[n]) / 2);
        const z = a === 0 ? e : n;
        own0.push(cy[z] * K + cx[z]);
      }
      if (mids.length === 2) emit(mids[0], mids[1], own0[0]);
      else if (mids.length === 4) { emit(mids[0], mids[3], own0[0]); emit(mids[1], mids[2], own0[2]); }
      else if (mids.length > 0) {
        // the front meets neutral ground or sea inside this block: run each crossing to the block centre
        const ctr = (2 * r + 2) * K + (2 * c + 2);
        for (let i = 0; i < mids.length; i++) emit(mids[i], ctr, own0[i]);
      }
    }
  }
  // chain oriented segments end-to-start
  const m = segs.length / 2;
  const out = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    const a = segs[2 * i], b = segs[2 * i + 1];
    let l = out.get(a); if (!l) out.set(a, (l = [])); l.push(i);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  }
  const used = new Uint8Array(m);
  const chains: number[][] = [];
  const walk = (i: number) => {
    const keys = [segs[2 * i]];
    let cur = i;
    for (;;) {
      used[cur] = 1;
      const end = segs[2 * cur + 1];
      keys.push(end);
      const next = out.get(end)?.find((j) => !used[j]);
      if (next === undefined) break;
      cur = next;
    }
    chains.push(keys);
  };
  for (let i = 0; i < m; i++) if (!used[i] && !indeg.get(segs[2 * i])) walk(i);
  for (let i = 0; i < m; i++) if (!used[i]) walk(i);
  const toLL = (k: number): [number, number] => {
    const x = k % K, y = Math.floor(k / K);
    return [west + (x / 2) * cellDeg, north - (y / 2) * cellDeg];
  };
  const features: Feature[] = [];
  for (const keys of chains) {
    let pts = keys.map(toLL);
    for (let it = 0; it < 2 && pts.length > 2; it++) pts = chaikin(pts);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
  }
  return { type: 'FeatureCollection', features };
}

/** One Chaikin corner-cutting pass; keeps both endpoints. */
function chaikin(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [p[0]];
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(p[p.length - 1]);
  return out;
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
