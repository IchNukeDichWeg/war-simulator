// Run context shared by the engine layers: immutable setup, mutable state, the
// RNG bound to the state, and scratch buffers that are recomputed every day
// (never part of a keyframe).
import type { Setup } from './setup';
import { SEASONS } from './setup';
import { monthOfDay, seasonOf } from './setup';
import type { SimState } from './state';
import { Rng } from './rng';
import { Heap } from './grid';
import { NR } from './roles';

export interface Battle {
  id: number;
  cell: number;
  att: 0 | 1;
  parts: [number[], number[]];
  airSorties: [number, number];
  airPow: [number, number];
  airLossFrac: [number, number];
  casualties: [number, number];
  winner: 0 | 1 | -1;
  endRound: number;
}

export interface Scratch {
  heap: Heap;
  invSpeed: [Float32Array, Float32Array];
  extra: [Float32Array, Float32Array];
  occ: [Int32Array, Int32Array];        // formations per side per cell (alive, on map)
  armed: Int32Array;                    // alive formations per member, on the map or on their way
  head: [Int32Array, Int32Array];       // linked list heads per side per cell
  nextInCell: Int32Array;
  battleAt: Int32Array;
  battles: Battle[];
  /** Personnel per side currently in sea cells (SEA_MOVEMENT lift accounting). */
  embarked: [number, number];
  /** Per-side cost per sea km for flow fields (Infinity: no sea movement this cycle). */
  seaInv: [number, number];
  claim: [Uint8Array, Uint8Array];
  prevControl: Uint8Array;
  forageTaken: Float32Array;
  demand: Float64Array;
  want: Float64Array;
  take: Float64Array;
  need: Float64Array;
  tmpN: Float32Array;
  tmpSrc: Int32Array;
  roleTmp: Float64Array;
  sectorPow: Float64Array;
  sectorCell: Int32Array;
  sectorBest: Float64Array;
  enemySeen: [Float32Array, Float32Array];  // per cell perceived enemy power, per observing side
  battleEventsToday: number;
}

export interface Ctx {
  S: Setup;
  st: SimState;
  rng: Rng;
  sc: Scratch;
}

export function makeScratch(S: Setup, cap: number): Scratch {
  const n = S.grid.n;
  return {
    heap: new Heap(n * 4),
    invSpeed: [new Float32Array(n), new Float32Array(n)],
    extra: [new Float32Array(n), new Float32Array(n)],
    occ: [new Int32Array(n), new Int32Array(n)],
    armed: new Int32Array(S.members.length),
    head: [new Int32Array(n), new Int32Array(n)],
    nextInCell: new Int32Array(Math.max(1, cap)),
    battleAt: new Int32Array(n).fill(-1),
    battles: [],
    embarked: [0, 0],
    seaInv: [Infinity, Infinity],
    claim: [new Uint8Array(n), new Uint8Array(n)],
    prevControl: new Uint8Array(n),
    forageTaken: new Float32Array(n),
    demand: new Float64Array(Math.max(1, S.sources[0].cell.length, S.sources[1].cell.length)),
    want: new Float64Array(Math.max(1, cap)),
    take: new Float64Array(Math.max(1, cap)),
    need: new Float64Array(Math.max(1, cap)),
    tmpN: new Float32Array(n),
    tmpSrc: new Int32Array(n),
    roleTmp: new Float64Array(NR),
    sectorPow: new Float64Array(4096),
    sectorCell: new Int32Array(4096),
    sectorBest: new Float64Array(4096),
    enemySeen: [new Float32Array(n), new Float32Array(n)],
    battleEventsToday: 0,
  };
}

/** Per-formation scratch arrays must cover the formation capacity. */
export function ensureScratchCap(sc: Scratch, cap: number): void {
  if (sc.nextInCell.length >= cap) return;
  sc.nextInCell = new Int32Array(cap);
  sc.want = new Float64Array(cap);
  sc.take = new Float64Array(cap);
  sc.need = new Float64Array(cap);
}

export function seasonIdx(ctx: Ctx, day = ctx.st.day): number {
  return seasonOf(monthOfDay(ctx.S.scenario.startMonth || 1, day), ctx.S.southern);
}

export function seasonName(ctx: Ctx, day = ctx.st.day): string {
  return SEASONS[seasonIdx(ctx, day)];
}

/** Rebuild per-side occupancy counts and per-cell linked lists of formations on the map. */
export function rebuildOccupancy(ctx: Ctx): void {
  const { st, sc } = ctx;
  const F = st.F;
  ensureScratchCap(sc, F.cap);
  sc.occ[0].fill(0); sc.occ[1].fill(0);
  sc.head[0].fill(-1); sc.head[1].fill(-1);
  sc.armed.fill(0);
  for (let f = F.n - 1; f >= 0; f--) {
    if (F.alive[f]) sc.armed[F.member[f]]++;
    if (!F.alive[f] || !F.onMap[f]) continue;
    const s = F.side[f], c = F.cell[f];
    sc.occ[s][c]++;
    sc.nextInCell[f] = sc.head[s][c];
    sc.head[s][c] = f;
  }
}

export function addEvent(ctx: Ctx, side: 0 | 1 | -1, kind: import('./protocol').SimEvent['kind'], text: string, why?: string, cell?: number): void {
  const ev: import('./protocol').SimEvent = { day: ctx.st.day, side, kind, text };
  if (why) ev.why = why;
  if (cell != null && cell >= 0) { ev.lat = +ctx.S.grid.lat[cell].toFixed(3); ev.lon = +ctx.S.grid.lon[cell].toFixed(3); }
  ctx.st.events.push(ev);
}
