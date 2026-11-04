// Theater grid: a window of the global 0.25 deg terrain grid (grid.bin), merged
// k x k when it would exceed MAX_THEATER_CELLS. Row 0 is the northern edge,
// same orientation as the global grid. 8-neighbour square lat/lon grid,
// distances are great-circle km between cell centres.
import { FLAG_COAST, FLAG_RIVER, GRID_H, GRID_RES, GRID_W, T, TERRAIN_CLASSES } from './terrainClasses';
import { CORNER_LAND_LINKS_CUT, MAX_THEATER_CELLS } from './constants';

const R_EARTH = 6371;
const DEG = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Global grid views over grid.bin (planar layout: class u8[N], flags u8[N], elev i16[N], relief u16[N]). */
export interface GlobalTerrain {
  cls: Uint8Array;
  flags: Uint8Array;
  relief: Uint16Array;
}

export function globalTerrain(buf: ArrayBuffer): GlobalTerrain {
  const N = GRID_W * GRID_H;
  if (!buf || buf.byteLength < N * 6) throw new Error(`terrain grid.bin has ${buf ? buf.byteLength : 0} bytes, expected ${N * 6}`);
  return {
    cls: new Uint8Array(buf, 0, N),
    flags: new Uint8Array(buf, N, N),
    relief: new Uint16Array(buf, N * 4, N),
  };
}

export interface Grid {
  cols: number;
  rows: number;
  n: number;
  k: number;               // merge factor (1 = native 0.25 deg)
  cellDeg: number;
  west: number;            // snapped western edge (deg, may exceed 180 when wrapping)
  north: number;           // snapped northern edge
  bbox: [number, number, number, number];
  cls: Uint8Array;
  flags: Uint8Array;
  relief: Uint16Array;
  lat: Float32Array;
  lon: Float32Array;
  area: Float32Array;      // km2
  land: Uint8Array;
  nb: Int32Array;          // n*8 neighbour index or -1
  nbKm: Float32Array;      // n*8 distance in km
  /** n*8: 1 where a diagonal link joins two land cells that touch only at a corner (both shared
   *  side neighbours water), a strait no army walks across (CORNER_LAND_LINKS_CUT). */
  corner: Uint8Array;
  landCount: number;
}

// Neighbour order: N, NE, E, SE, S, SW, W, NW
export const DR = [-1, -1, 0, 1, 1, 1, 0, -1];
export const DC = [0, 1, 1, 1, 0, -1, -1, -1];

export function buildGrid(g: GlobalTerrain, bbox: [number, number, number, number], maxCells = MAX_THEATER_CELLS): Grid {
  let [w, s, e, nn] = bbox;
  if (!(nn > s)) throw new Error(`theater bbox has north <= south: ${bbox.join(',')}`);
  w = ((w + 180) % 360 + 360) % 360 - 180;
  e = bbox[0] === w ? e : e + (w - bbox[0]);
  if (e <= w) e += 360;
  const c0 = Math.floor((w + 180) / GRID_RES + 1e-9);
  const c1 = Math.max(c0 + 1, Math.ceil((e + 180) / GRID_RES - 1e-9));
  const r0 = Math.max(0, Math.floor((90 - nn) / GRID_RES + 1e-9));
  const r1 = Math.min(GRID_H, Math.max(r0 + 1, Math.ceil((90 - s) / GRID_RES - 1e-9)));
  const gCols = Math.min(GRID_W, c1 - c0);
  const gRows = r1 - r0;
  let k = 1;
  while (Math.ceil(gCols / k) * Math.ceil(gRows / k) > maxCells) k++;
  const cols = Math.ceil(gCols / k);
  const rows = Math.ceil(gRows / k);
  const n = cols * rows;
  const cellDeg = GRID_RES * k;
  const west = -180 + c0 * GRID_RES;
  const north = 90 - r0 * GRID_RES;
  const cls = new Uint8Array(n), flags = new Uint8Array(n), relief = new Uint16Array(n);
  const lat = new Float32Array(n), lon = new Float32Array(n), area = new Float32Array(n), land = new Uint8Array(n);
  const counts = new Int32Array(TERRAIN_CLASSES.length);
  for (let R = 0; R < rows; R++) {
    for (let C = 0; C < cols; C++) {
      counts.fill(0);
      let rel = 0, fl = 0;
      for (let dr = 0; dr < k; dr++) {
        const gr = r0 + R * k + dr;
        if (gr >= r1) break;
        for (let dc = 0; dc < k; dc++) {
          const gcRaw = C * k + dc;
          if (gcRaw >= gCols) break;
          const gi = gr * GRID_W + ((c0 + gcRaw) % GRID_W + GRID_W) % GRID_W;
          counts[g.cls[gi]]++;
          if (g.relief[gi] > rel) rel = g.relief[gi];
          if (g.cls[gi] !== T.water) fl |= g.flags[gi] & FLAG_RIVER;
        }
      }
      let best = 0;
      for (let t = 1; t < counts.length; t++) if (counts[t] > counts[best]) best = t;
      const i = R * cols + C;
      cls[i] = best;
      relief[i] = rel;
      flags[i] = best === T.water ? 0 : fl;
      land[i] = best === T.water ? 0 : 1;
      const la = north - (R + 0.5) * cellDeg;
      // continuous longitude across the theater (may exceed 180 when it crosses the antimeridian)
      const lo = west + (C + 0.5) * cellDeg;
      lat[i] = la;
      lon[i] = lo;
      const side = cellDeg * 111.32;
      area[i] = side * side * Math.cos(la * DEG);
    }
  }
  const nb = new Int32Array(n * 8).fill(-1);
  const nbKm = new Float32Array(n * 8);
  const corner = new Uint8Array(n * 8);
  let landCount = 0;
  for (let R = 0; R < rows; R++) {
    for (let C = 0; C < cols; C++) {
      const i = R * cols + C;
      if (land[i]) landCount++;
      for (let d = 0; d < 8; d++) {
        const rr = R + DR[d], cc = C + DC[d];
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        nb[i * 8 + d] = j;
        nbKm[i * 8 + d] = haversineKm(lat[i], lon[i], lat[j], lon[j]);
        if (land[i] && !land[j] && (d & 1) === 0) flags[i] |= FLAG_COAST;
        // diagonal: the two side neighbours are (R + DR, C) and (R, C + DC), both inside the grid
        if ((d & 1) === 1 && land[i] && land[j] && !land[rr * cols + C] && !land[R * cols + cc]) corner[i * 8 + d] = 1;
      }
    }
  }
  return {
    cols, rows, n, k, cellDeg, west, north,
    // east > 180 when the theater crosses the antimeridian; never east < west
    bbox: [west, north - rows * cellDeg, west + cols * cellDeg, north],
    cls, flags, relief, lat, lon, area, land, nb, nbKm, corner, landCount,
  };
}

/** Theater cell containing (lat, lon), or -1 outside the theater. */
export function cellAt(grid: Grid, lat: number, lon: number): number {
  const R = Math.floor((grid.north - lat) / grid.cellDeg);
  let dl = lon - grid.west;
  dl = ((dl % 360) + 360) % 360;
  const C = Math.floor(dl / grid.cellDeg);
  if (R < 0 || R >= grid.rows || C < 0 || C >= grid.cols) return -1;
  return R * grid.cols + C;
}

/** Nearest land cell to (lat, lon) within the theater (search rings), or -1. */
export function nearestLand(grid: Grid, lat: number, lon: number, maxRing = 50): number {
  const R0 = Math.floor((grid.north - lat) / grid.cellDeg);
  let dl = lon - grid.west;
  dl = ((dl % 360) + 360) % 360;
  const C0 = Math.floor(dl / grid.cellDeg);
  const Rc = Math.min(grid.rows - 1, Math.max(0, R0));
  const Cc = Math.min(grid.cols - 1, Math.max(0, C0));
  for (let ring = 0; ring <= maxRing; ring++) {
    let best = -1, bestD = Infinity;
    for (let R = Rc - ring; R <= Rc + ring; R++) {
      if (R < 0 || R >= grid.rows) continue;
      for (let C = Cc - ring; C <= Cc + ring; C++) {
        if (C < 0 || C >= grid.cols) continue;
        if (Math.max(Math.abs(R - Rc), Math.abs(C - Cc)) !== ring) continue;
        const i = R * grid.cols + C;
        if (!grid.land[i]) continue;
        const d = haversineKm(lat, lon, grid.lat[i], grid.lon[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Point in bbox [w, s, e, n]; e > 180 (or e < w) means the box crosses the antimeridian. */
export function inBbox(bbox: [number, number, number, number], lat: number, lon: number): boolean {
  const [w, s, e0, n] = bbox;
  if (lat < s || lat > n) return false;
  let e = e0;
  if (e < w) e += 360;
  let x = lon;
  while (x < w) x += 360;
  while (x >= w + 360) x -= 360;
  return x <= e;
}

/**
 * Rasterise a GeoJSON MultiPolygon (lon/lat) onto the grid: calls `hit(cell)` for
 * every cell whose centre is inside (even-odd rule, holes respected). Scanline per
 * grid row, so cost is rows x edges rather than cells x edges.
 */
export function rasterizeMultiPolygon(grid: Grid, mp: number[][][][], hit: (cell: number) => void): void {
  const xs: number[] = [];
  for (let R = 0; R < grid.rows; R++) {
    const la = grid.north - (R + 0.5) * grid.cellDeg;
    xs.length = 0;
    for (const poly of mp) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const yi = ring[i][1], yj = ring[j][1];
          if ((yi > la) !== (yj > la)) {
            const xi = ring[i][0], xj = ring[j][0];
            xs.push(xi + ((la - yi) / (yj - yi)) * (xj - xi));
          }
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let p = 0; p + 1 < xs.length; p += 2) {
      // columns whose centre lon is in [xs[p], xs[p+1])
      for (let C = 0; C < grid.cols; C++) {
        const lo = grid.west + (C + 0.5) * grid.cellDeg;
        // polygons are in [-180, 180]; test the cell centre at both of its longitudes
        if ((lo >= xs[p] && lo < xs[p + 1]) || (lo - 360 >= xs[p] && lo - 360 < xs[p + 1])) hit(R * grid.cols + C);
      }
    }
  }
}

/** Binary min-heap over (key, value) with lazy deletion; reused across Dijkstra runs. */
export class Heap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number): void {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.vals.length * 2); nv.set(this.vals); this.vals = nv;
    }
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }
  /** Pops the min; returns its value, and its key in this.lastKey. */
  lastKey = 0;
  pop(): number {
    const K = this.keys, V = this.vals;
    const topV = V[0];
    this.lastKey = K[0];
    const n = --this.size;
    if (n > 0) {
      const k = K[n], v = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= k) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = k; V[i] = v;
    }
    return topV;
  }
}

/**
 * Multi-source Dijkstra over the grid. Entering cell b from a costs
 * nbKm(a,b) * invSpeed[b] + extra[b]; invSpeed = Infinity marks impassable cells.
 * Writes distances into `dist` (Infinity unreachable) and source ids into `src`.
 */
export function dijkstra(grid: Grid, heap: Heap, invSpeed: Float32Array, extra: Float32Array | null,
  sources: ArrayLike<number>, initCost: ArrayLike<number> | null, dist: Float32Array, src: Int32Array | null): void {
  dist.fill(Infinity);
  if (src) src.fill(-1);
  heap.size = 0;
  for (let s = 0; s < sources.length; s++) {
    const c = sources[s];
    if (c < 0) continue;
    // keys are rounded to float32 like the stored distances, so the stale-entry check below
    // compares equal values (a Float64 key above its Float32 copy was skipped as stale and
    // left 15-23% of reachable cells unreachable on the backtest campaign grids)
    const k0 = Math.fround(initCost ? initCost[s] : 0);
    if (k0 < dist[c]) { dist[c] = k0; if (src) src[c] = s; heap.push(k0, c); }
  }
  const nb = grid.nb, nbKm = grid.nbKm;
  const corner = CORNER_LAND_LINKS_CUT ? grid.corner : null;
  while (heap.size > 0) {
    const a = heap.pop();
    const da = heap.lastKey;
    if (da > dist[a]) continue;
    const sa = src ? src[a] : 0;
    const base = a * 8;
    for (let d = 0; d < 8; d++) {
      const b = nb[base + d];
      if (b < 0 || (corner && corner[base + d])) continue;
      const inv = invSpeed[b];
      if (inv === Infinity) continue;
      const nd = Math.fround(da + nbKm[base + d] * inv + (extra ? extra[b] : 0));
      if (nd < dist[b]) {
        dist[b] = nd;
        if (src) src[b] = sa;
        heap.push(nd, b);
      }
    }
  }
}
