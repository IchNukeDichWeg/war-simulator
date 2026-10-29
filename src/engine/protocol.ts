// Messages between the UI thread and the simulation worker. The engine never
// touches the DOM; the UI never mutates engine state. Everything here must be
// structured-cloneable; big arrays are sent as transferables.
import type { DoctrineProfile, Snapshot } from '../types/schema';
import type { Mechanics } from '../types/mechanics';
import type { Scenario } from '../types/scenario';

export interface EngineData {
  snapshots: Snapshot[];
  doctrines: DoctrineProfile[];
  mechanics: Mechanics;
  /** public/data/terrain/grid.bin as loaded. */
  terrain: ArrayBuffer;
  /** Border polygons per snapshot id (GeoJSON MultiPolygon coordinates). */
  borders: Record<string, number[][][][]>;
}

/** Per-unit record in a Frame, UNIT_STRIDE floats per formation. */
export const UNIT_STRIDE = 12;
export const U = {
  lon: 0, lat: 1, side: 2, role: 3,          // role = index of the dominant UnitRole (icon)
  strength: 4,                               // current / starting strength, 0..1
  heading: 5,                                // radians, direction of movement (NaN = stationary)
  supply: 6,                                 // 0..1 fraction of needs met today
  morale: 7,                                 // 0..1
  status: 8,                                 // UnitStatus enum below
  id: 9,
  personnel: 10,                             // absolute personnel, for tooltips
  techEra: 11,                               // weapons tech level, for era-appropriate icons
} as const;

export enum UnitStatus { Idle = 0, Moving = 1, Engaged = 2, Routing = 3, Besieging = 4, Garrison = 5, Embarked = 6, Destroyed = 7 }

export interface SideStats {
  personnel: number;
  platforms: number;          // sum of N-role counts
  casualties: number;         // cumulative killed + wounded + captured
  lossesByCause: Record<LossCause, number>;
  supply: number;             // 0..1 average fraction of needs met today
  morale: number;             // 0..1 strength-weighted average
  territory: number;          // fraction of theater land cells controlled
  seaControl: number;         // 0..1
  airSuperiority: number;     // 0..1
}

export type LossCause = 'combat' | 'pursuit' | 'captured' | 'disease' | 'starvation' | 'exposure' | 'desertion' | 'air' | 'naval' | 'nuclear';

export interface SimEvent {
  day: number;
  side: 0 | 1 | -1;           // -1 = neutral / both
  kind: 'battle' | 'rout' | 'siege' | 'capture' | 'supply' | 'naval' | 'air' | 'mobilization' | 'arrival' | 'nuclear' | 'weather' | 'end';
  lat?: number;
  lon?: number;
  text: string;               // one sentence, says what happened
  why?: string;               // one sentence, says why (the dominant modifiers)
}

export interface Frame {
  day: number;
  date: string;               // e.g. "Day 34, spring"
  units: Float32Array;        // UNIT_STRIDE x n
  stats: [SideStats, SideStats];
  /** Theater control grid, one byte per theater cell: 0/1 side, 255 neutral/sea. Sent every N days or on change. */
  control?: Uint8Array;
  /** Supply lines as polylines [lon, lat, lon, lat, ...] per side, sent with control. */
  supplyLines?: [number[][], number[][]];
  battles: { lat: number; lon: number; intensity: number }[];
  events: SimEvent[];         // new since previous frame
}

export interface TheaterInfo {
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  cellDeg: number;
}

export interface Reason {
  factor: string;             // e.g. "Tech gap", "Supply collapse", "Lost naval control"
  side: 0 | 1;                // the side this factor favoured
  weight: number;             // 0..1 share of the explanation
  detail: string;             // one or two sentences with the numbers
}

export interface RunResult {
  winner: 0 | 1 | 'draw';
  endDay: number;
  endReason: string;          // which victory condition fired
  stats: [SideStats, SideStats];
  reasons: Reason[];          // ranked, top first
  seed: number;
}

export interface MonteCarloResult {
  runs: number;
  winProb: [number, number, number];   // side 0, side 1, draw
  endDay: { p10: number; p50: number; p90: number };
  casualties: [{ p10: number; p50: number; p90: number }, { p10: number; p50: number; p90: number }];
  topReasons: Reason[];
  results: RunResult[];
}

export type ToWorker =
  | { type: 'init'; data: EngineData }
  | { type: 'start'; scenario: Scenario }
  | { type: 'speed'; daysPerSecond: number }   // 0 = paused
  | { type: 'step'; days: number }
  | { type: 'seek'; day: number }              // replay: deterministic re-simulation from keyframes
  | { type: 'montecarlo'; scenario: Scenario; runs: number };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'started'; theater: TheaterInfo; sideNames: [string, string]; warnings: string[] }
  | { type: 'frame'; frame: Frame }
  | { type: 'end'; result: RunResult }
  | { type: 'mcProgress'; done: number; total: number }
  | { type: 'mcResult'; result: MonteCarloResult }
  | { type: 'error'; message: string };
