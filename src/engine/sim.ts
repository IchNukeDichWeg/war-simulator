// Simulation core: createSim(data, scenario) -> step / frame / result / clone.
// Daily layer order (ENGINE.md 1): weather -> production/mobilization ->
// command AI -> movement -> battles found -> naval and air -> tactical
// resolution and sieges -> logistics and attrition (incl. morale) -> control ->
// nuclear -> victory.
import type { EngineData, Frame, RunResult } from './protocol';
import type { Scenario } from '../types/scenario';
import { buildSetup, type Setup, type SimOptions, WEATHERS } from './setup';
import { allocFormations, cloneState, newAccum, type SimState, NLC } from './state';
import { Rng } from './rng';
import { makeScratch, rebuildOccupancy, addEvent, seasonIdx, type Ctx } from './ctx';
import { spawnFormation } from './formations';
import { NR } from './roles';
import { AI_MAX_OBJECTIVES, RETURN_TO_DUTY_DAYS } from './constants';
import { productionPhase } from './production';
import { aiPhase } from './ai';
import { movementPhase } from './movement';
import { detectBattles, resolveBattles, siegePhase } from './combat';
import { navalPhase } from './naval';
import { airPhase } from './air';
import { logisticsPhase } from './logistics';
import { controlPhase, victoryPhase } from './victory';
import { nuclearPhase } from './nuclear';
import { explain } from './explain';
import { buildFrame, sideStats, type FrameCursor } from './frame';
import { SEASONS } from './setup';

export interface Sim {
  readonly setup: Setup;
  readonly ctx: Ctx;
  day(): number;
  ended(): boolean;
  /** Advance up to `days` days (stops at the end of the war). */
  step(days?: number): void;
  /** Frame for the current day with events since the previous frame. */
  frame(forceControl?: boolean): Frame;
  /** Result once ended; `force` builds one for an unfinished run (time-limit style). */
  result(force?: boolean): RunResult | null;
  snapshot(): SimState;
  restore(s: SimState): void;
  /** Reset the frame cursor so the next frame carries events from `day` on and full control. */
  resetCursor(fromDay?: number): void;
}

function initState(S: Setup, seed: number): { st: SimState; rng: Rng } {
  const n = S.grid.n;
  const rng = new Rng(seed);
  const F = allocFormations(Math.max(16, Math.ceil(S.seeds.length * 1.25) + 16));
  const st: SimState = {
    day: 0,
    rng: rng.s,
    F,
    control: S.control0.slice(),
    forage: new Float32Array(n).fill(1),
    siege: new Float32Array(n),
    supplyDist: [new Float32Array(n).fill(Infinity), new Float32Array(n).fill(Infinity)],
    supplySrc: [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)],
    fields: [new Float32Array(n * AI_MAX_OBJECTIVES), new Float32Array(n * AI_MAX_OBJECTIVES)],
    objCells: [new Int32Array(AI_MAX_OBJECTIVES).fill(-1), new Int32Array(AI_MAX_OBJECTIVES).fill(-1)],
    objKind: [new Uint8Array(AI_MAX_OBJECTIVES), new Uint8Array(AI_MAX_OBJECTIVES)],
    nextPlanDay: [1, 1],
    fleet: [S.fleet0[0].slice(), S.fleet0[1].slice()],
    air: [S.air0[0].slice(), S.air0[1].slice()],
    seaControl: [0.5, 0.5],
    airSup: [0, 0],
    airHolds: [false, false],
    interdiction: [0, 0],
    weather: 0,
    members: S.members.map((mr) => ({
      depot: new Float64Array(NR),
      returns: new Float64Array(RETURN_TO_DUTY_DAYS),
      mobilizableLeft: mr.mobilizable0 * mr.commitment,
      reservesDue: S.battleMode || S.opts.noProduction ? 0 : mr.reserves * mr.commitment,
      reservesDay: Math.ceil(mr.mobilizationDays + mr.oneWayDays),
      recruitQueue: [],
      warheads: Math.floor(mr.snap.strategic?.nuclearWarheads?.mid ?? 0),
      lastNukeDay: -1,
      productionDamage: 1,
      capitalLost: false,
      capitalHeldDays: 0,
    })),
    losses: [new Float64Array(NLC), new Float64Array(NLC)],
    platformLosses: [0, 0],
    arrivals: [0, 0],
    returned: [0, 0],
    nextLiftDay: S.members.map(() => 0),
    startPersonnel: [0, 0],
    startW: [0, 0],
    startMorale: [0, 0],
    addedW: [0, 0],
    events: [],
    battlesToday: [],
    acc: newAccum(),
    ended: false,
    winner: null,
    endReason: '',
    endFraction: 1,
    lastActivityDay: 0,
    battleModeContact: false,
    controlVersion: 0,
  };
  return { st, rng };
}

export function simFromSetup(S: Setup, seed: number): Sim {
  const { st, rng } = initState(S, seed);
  const ctx: Ctx = { S, st, rng, sc: makeScratch(S, st.F.cap) };
  for (const sd of S.seeds) spawnFormation(ctx, sd.member, sd.cell, sd.counts, sd.arriveDay <= 0, sd.arriveDay);
  st.addedW = [0, 0];
  const F = st.F;
  for (let f = 0; f < F.n; f++) {
    st.startPersonnel[F.side[f]] += F.personnel[f];
    st.startW[F.side[f]] += F.curW[f];
    st.startMorale[F.side[f]] += F.morale[f] * F.curW[f];
  }
  for (const s of [0, 1] as const) st.startMorale[s] = st.startW[s] > 0 ? st.startMorale[s] / st.startW[s] : 0;
  rebuildOccupancy(ctx);
  for (const w of S.warnings) void w;
  const cursor: FrameCursor = { eventIdx: 0, controlVersion: -1, controlDay: -1 };

  const stepDay = () => {
    if (st.ended) return;
    st.day++;
    st.battlesToday.length = 0;
    // weather
    const prevW = st.weather;
    if (S.scenario.rules.weather) {
      const odds = S.m.movement.weatherOdds[SEASONS[seasonIdx(ctx)]];
      let u = rng.next() * WEATHERS.reduce((a, w) => a + (odds[w] ?? 0), 0);
      let wi = 0;
      for (; wi < WEATHERS.length - 1; wi++) { u -= odds[WEATHERS[wi]] ?? 0; if (u < 0) break; }
      st.weather = wi;
    } else st.weather = 0;
    if (st.weather !== prevW && (st.weather === 2 || st.weather === 3)) addEvent(ctx, -1, 'weather', `${WEATHERS[st.weather] === 'mud' ? 'Mud' : 'Snow'} slows movement across the theater.`);
    rebuildOccupancy(ctx);
    productionPhase(ctx);
    aiPhase(ctx);
    movementPhase(ctx);
    detectBattles(ctx);
    navalPhase(ctx);
    airPhase(ctx);
    resolveBattles(ctx);
    siegePhase(ctx);
    logisticsPhase(ctx);
    rebuildOccupancy(ctx);
    controlPhase(ctx);
    nuclearPhase(ctx);
    victoryPhase(ctx);
  };

  const result = (force = false): RunResult | null => {
    if (!st.ended && !force) return null;
    const reasons = explain(ctx);
    const w = st.winner;
    if (w === 0 || w === 1) reasons.sort((a, b) => (a.side === w ? 0 : 1) - (b.side === w ? 0 : 1) || b.weight - a.weight);
    return {
      winner: st.ended ? (st.winner as 0 | 1 | 'draw') : 'draw',
      endDay: st.ended ? st.day - 1 + st.endFraction : st.day,
      endReason: st.ended ? st.endReason : 'not finished',
      stats: [sideStats(ctx, 0), sideStats(ctx, 1)],
      reasons,
      seed,
    };
  };

  return {
    setup: S,
    ctx,
    day: () => st.day,
    ended: () => st.ended,
    step(days = 1) {
      for (let i = 0; i < days && !ctx.st.ended; i++) stepDay();
    },
    frame(forceControl = false) {
      return buildFrame(ctx, cursor, forceControl);
    },
    result,
    snapshot() {
      return cloneState(ctx.st);
    },
    restore(s: SimState) {
      const c = cloneState(s);
      Object.assign(st, c);
      rng.s = st.rng;
      ctx.sc = makeScratch(S, st.F.cap);
      rebuildOccupancy(ctx);
    },
    resetCursor(fromDay?: number) {
      let i = st.events.length;
      if (fromDay != null) { i = 0; while (i < st.events.length && st.events[i].day < fromDay) i++; }
      cursor.eventIdx = i;
      cursor.controlVersion = -1;
    },
  };
}

export function createSim(data: EngineData, scenario: Scenario, opts?: SimOptions): Sim {
  return simFromSetup(buildSetup(data, scenario, opts), scenario.seed);
}

/** Run to the end (or maxDays) without frames. */
export function runToEnd(sim: Sim, maxDays = Infinity): RunResult {
  while (!sim.ended() && sim.day() < maxDays) sim.step(1);
  return sim.result(true)!;
}
