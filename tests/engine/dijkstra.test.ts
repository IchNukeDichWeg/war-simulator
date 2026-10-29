import { describe, expect, it } from 'vitest';
import { buildGrid, dijkstra, globalTerrain, Heap } from '../../src/engine/grid';
import { Rng } from '../../src/engine/rng';
import { fixtureTerrain } from '../fixtures/snapshots.fixture';

/** Plain O(n^2) Dijkstra in Float64, the reference. */
function reference(n: number, nb: Int32Array, nbKm: Float32Array | Float64Array, inv: Float32Array, extra: Float32Array,
  sources: number[], init: number[]): Float64Array {
  const d = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  sources.forEach((c, i) => { d[c] = Math.min(d[c], init[i]); });
  for (;;) {
    let a = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; a = i; }
    if (a < 0) break;
    done[a] = 1;
    for (let k = 0; k < 8; k++) {
      const b = nb[a * 8 + k];
      if (b < 0 || inv[b] === Infinity) continue;
      const nd = d[a] + nbKm[a * 8 + k] * inv[b] + extra[b];
      if (nd < d[b]) d[b] = nd;
    }
  }
  return d;
}

describe('dijkstra', () => {
  const grid = buildGrid(globalTerrain(fixtureTerrain()), [0, 0, 6, 6]);   // 24 x 24 cells
  it.each([1, 2, 3, 4, 5])('matches a Float64 reference on a random grid (seed %i)', (seed) => {
    const rng = new Rng(seed);
    const n = grid.n;
    const inv = new Float32Array(n), extra = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      inv[c] = rng.next() < 0.15 ? Infinity : 0.5 + 3 * rng.next();      // walls and uneven costs
      extra[c] = rng.next() < 0.1 ? 0.37 * rng.next() : 0;
    }
    const sources: number[] = [], init: number[] = [];
    for (let k = 0; k < 6; k++) { sources.push(rng.int(n)); init.push(rng.next() * 50); }
    const dist = new Float32Array(n);
    dijkstra(grid, new Heap(64), inv, extra, sources, init, dist, new Int32Array(n));
    const ref = reference(n, grid.nb, grid.nbKm, inv, extra, sources, init);
    let finite = 0;
    for (let c = 0; c < n; c++) {
      if (ref[c] === Infinity) { expect(dist[c]).toBe(Infinity); continue; }
      finite++;
      expect(dist[c]).not.toBe(Infinity);
      expect(Math.abs(dist[c] - ref[c])).toBeLessThanOrEqual(1e-4 * Math.max(1, ref[c]));
    }
    expect(finite).toBeGreaterThan(n / 2);
  });
});
