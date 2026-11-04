// Mutable simulation state. Everything that changes during a run lives here and
// nothing else does, so structuredClone(state) is a complete keyframe and
// restoring it reproduces the run exactly. Formations are stored as a
// structure of typed arrays (one slot per formation, never reused).
import { NR, LOSS_CAUSES } from './roles';
import type { SimEvent } from './protocol';

/** Formation command mode (state.F.mode). */
export const Mode = { Hold: 0, Attack: 1, Defend: 2, Retreat: 3, Rout: 4 } as const;

type TA = Float64Array | Float32Array | Int32Array | Int16Array | Uint8Array | Uint16Array;
type Ctor = new (n: number) => TA;

/** [name, constructor, stride] of every per-formation array. */
const FIELDS: [string, Ctor, number][] = [
  ['member', Int16Array, 1], ['side', Uint8Array, 1], ['alive', Uint8Array, 1],
  ['cell', Int32Array, 1], ['next', Int32Array, 1], ['prog', Float32Array, 1], ['edge', Float32Array, 1],
  ['counts', Float64Array, NR], ['startW', Float64Array, 1], ['curW', Float64Array, 1],
  ['personnel', Float64Array, 1], ['startPersonnel', Float64Array, 1],
  ['morale', Float32Array, 1], ['supply', Float32Array, 1], ['stock', Float32Array, 1],
  ['engLoss', Float32Array, 1], ['engagedDays', Uint16Array, 1], ['noSupplyDays', Uint16Array, 1],
  ['status', Uint8Array, 1], ['mode', Uint8Array, 1], ['obj', Int32Array, 1],
  ['pendObj', Int32Array, 1], ['pendMode', Uint8Array, 1], ['pendDay', Int32Array, 1],
  ['heading', Float32Array, 1], ['movedKm', Float32Array, 1], ['fought', Uint8Array, 1], ['moved', Uint8Array, 1],
  ['stillDays', Uint16Array, 1], ['arriveDay', Int32Array, 1], ['onMap', Uint8Array, 1],
  ['feignUsed', Uint8Array, 1], ['routDays', Uint16Array, 1], ['battle', Int32Array, 1], ['spawnCell', Int32Array, 1],
  ['joinDay', Int32Array, 1], ['joinRound', Uint8Array, 1],
];

export interface Formations {
  cap: number;
  n: number;
  member: Int16Array; side: Uint8Array; alive: Uint8Array;
  cell: Int32Array; next: Int32Array; prog: Float32Array; edge: Float32Array;
  counts: Float64Array; startW: Float64Array; curW: Float64Array;
  personnel: Float64Array; startPersonnel: Float64Array;
  morale: Float32Array; supply: Float32Array; stock: Float32Array;
  engLoss: Float32Array; engagedDays: Uint16Array; noSupplyDays: Uint16Array;
  status: Uint8Array; mode: Uint8Array; obj: Int32Array;
  pendObj: Int32Array; pendMode: Uint8Array; pendDay: Int32Array;
  heading: Float32Array; movedKm: Float32Array; fought: Uint8Array; moved: Uint8Array;
  stillDays: Uint16Array; arriveDay: Int32Array; onMap: Uint8Array;
  feignUsed: Uint8Array; routDays: Uint16Array; battle: Int32Array; spawnCell: Int32Array;
  /** Joins the battle of day joinDay only from round joinRound (sub-day reinforcements). */
  joinDay: Int32Array; joinRound: Uint8Array;
}

export function allocFormations(cap: number): Formations {
  const f: any = { cap, n: 0 };
  for (const [name, C, stride] of FIELDS) f[name] = new C(Math.max(1, cap) * stride);
  return f as Formations;
}

export function growFormations(f: Formations, need: number): void {
  if (need <= f.cap) return;
  const cap = Math.max(need, Math.ceil(f.cap * 1.5) + 16);
  const any = f as any;
  for (const [name, C, stride] of FIELDS) {
    const a = new C(cap * stride);
    a.set(any[name]);
    any[name] = a;
  }
  f.cap = cap;
}

export interface Accum {
  /** Battle-weighted sums: [sum of log(side0/side1) x weight, sum of weight]. */
  tech: [number, number];
  numbers: [number, number];
  /** Same form: engaged personnel, and combat power at the opening round (all factors). */
  personnel: [number, number];
  power: [number, number];
  command: [number, number];
  terrain: [number, number];
  air: [number, number];
  battles: number;
  battleWins: [number, number];
  routs: [number, number];
  shortfallDays: [number, number];      // formation-days below full supply, weighted by shortfall
  formationDays: [number, number];
  seaControlSum: number;                // sum over days of side-0 sea control
  seaDays: number;
  airSupSum: number;                    // sum over days of (side0 - side1) air superiority
  airDays: number;
  nonBattle: [number, number];
  battleLoss: [number, number];
}

export function newAccum(): Accum {
  return {
    tech: [0, 0], numbers: [0, 0], personnel: [0, 0], power: [0, 0], command: [0, 0], terrain: [0, 0], air: [0, 0],
    battles: 0, battleWins: [0, 0], routs: [0, 0], shortfallDays: [0, 0], formationDays: [0, 0],
    seaControlSum: 0, seaDays: 0, airSupSum: 0, airDays: 0, nonBattle: [0, 0], battleLoss: [0, 0],
  };
}

export interface MemberState {
  depot: Float64Array;          // NR counts waiting to form/join formations
  returns: Float64Array;        // RETURN_RING_DAYS ring of personnel returning, slot = return day % ring
  mobilizableLeft: number;
  reservesDue: number;          // personnel still to arrive from reserve call-up
  reservesDay: number;
  recruitQueue: number[];       // flat [readyDay, amount, ...]
  warheads: number;
  lastNukeDay: number;
  productionDamage: number;     // multiplier from nuclear city strikes
  capitalLost: boolean;
  capitalHeldDays: number;      // days the capital has been held by the enemy
  capitalReached: boolean;      // an enemy formation has been on or next to the capital since the enemy took it
  breakpoint: number;           // this seed's battle breakpoint (cohesion-shifted)
  retreat: number;              // withdraw threshold: WITHDRAW_SHARE_OF_BREAKPOINT x breakpoint (SYMMETRIC_DOCTRINE_BREAKPOINT)
  fielded: number;              // personnel at the start plus every arrival, as the side's startPersonnel + arrivals
  broken: boolean;              // below the army-collapse share of `fielded` now (MEMBER_COLLAPSE; sticky with MEMBER_COLLAPSE_RECOVERS OFF)
  brokeOnce: boolean;           // its collapse event has fired (once per run)
}

export interface BattleRec { lat: number; lon: number; intensity: number }

export interface SimState {
  day: number;
  /** AI required force ratio at maneuver weight 0 and 1, drawn per seed (AI_RATIOS_FROM_MODEL_RULES). */
  aiRatio: { attrition: number; maneuver: number };
  rng: Uint32Array;
  F: Formations;
  control: Uint8Array;          // per cell: 0/1 side, 255 neutral or sea
  forage: Float32Array;         // remaining forage fraction per cell
  siege: Float32Array;          // siege progress per cell 0..1
  supplyDist: [Float32Array, Float32Array];
  supplySrc: [Int32Array, Int32Array];
  /** Flow fields: per side AI_MAX_OBJECTIVES x cells (cost to reach the objective). */
  fields: [Float32Array, Float32Array];
  /** Objective cell of each field slot (-1 unused) and its kind (OBJ_* in ai.ts). */
  objCells: [Int32Array, Int32Array];
  objKind: [Uint8Array, Uint8Array];
  nextPlanDay: [number, number];
  fleet: [Float64Array, Float64Array];
  air: [Float64Array, Float64Array];
  seaControl: [number, number];
  airSup: [number, number];
  airHolds: [boolean, boolean];
  interdiction: [number, number];       // sorties of interdiction flown by each side today
  weather: number;                      // index into WEATHERS
  members: MemberState[];
  losses: [Float64Array, Float64Array]; // personnel losses by LOSS_CAUSES index
  platformLosses: [number, number];
  arrivals: [number, number];           // personnel that entered the theater after day 0 (not returns to duty)
  returned: [number, number];           // returned to duty from hospital
  hospital: [number, number];           // in hospital now (non-battle admissions due back to duty)
  nextLiftDay: number[];                // per member: next day a sea-lift wave can carry depot troops
  startPersonnel: [number, number];
  startW: [number, number];
  startMorale: [number, number];
  /** 'destroy' objectives: the enemy formations within the radius at the start, per side holding the objective. */
  destroyTargets: [number[], number[]];
  addedW: [number, number];
  events: SimEvent[];
  battlesToday: BattleRec[];
  acc: Accum;
  ended: boolean;
  winner: 0 | 1 | 'draw' | null;
  endReason: string;
  endFraction: number;                  // fraction of the final day used (battle mode)
  lastActivityDay: number;
  battleModeContact: boolean;
  controlVersion: number;
}

export const NLC = LOSS_CAUSES.length;

export function cloneState(s: SimState): SimState {
  return structuredClone(s);
}
