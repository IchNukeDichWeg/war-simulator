import { describe, expect, it } from 'vitest';
import { createSim, runToEnd } from '../../src/engine/sim';
import { battleCaseScenario } from '../../src/engine/battleCase';
import { rebuildOccupancy } from '../../src/engine/ctx';
import { buildGrid, cellAt, dijkstra, globalTerrain, Heap } from '../../src/engine/grid';
import { GRID_H, GRID_W, T, cellIndex } from '../../src/engine/terrainClasses';
import { dailyBudget, movementPhase, seaLift, seaLoad } from '../../src/engine/movement';
import type { BattleCase } from '../../src/types/mechanics';
import { loadEngineData } from '../../scripts/lib/loadData';
import { RI } from '../../src/engine/roles';
import { Mode } from '../../src/engine/state';
import type { EngineData } from '../../src/engine/protocol';
import { NATIONS, fixtureScenario, makeSnapshot, type NationSpec } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Regression tests for the pre-release combat and movement fixes (VALIDATION.md, "Pre-release
// engine fixes: combat and movement"). Each block names its toggle in constants.ts.

const rect = ([w, s, e, n]: [number, number, number, number]): number[][][][] => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
function withNations(...specs: NationSpec[]): EngineData {
  const d = data();
  return {
    ...d,
    snapshots: [...d.snapshots, ...specs.map(makeSnapshot)],
    borders: { ...d.borders, ...Object.fromEntries(specs.map((s) => [s.id, rect(s.rect)])) },
  };
}

describe('AIR_INTERDICTION_BY_HOLDER', () => {
  // a modern state with a tenth of the Superpower's fighters: the Superpower holds the air
  const weakAir: NationSpec = {
    id: 'weakair-2026', name: 'Weakair', year: 2026, tech: 10, capital: { lat: 5, lon: 1 }, rect: [0, 0, 5, 10],
    forces: { infantry_line: 60000, armor: 400, artillery: 200, aircraft_fighter: 30, aircraft_strike: 20 }, supplyRangeKm: 500,
  };
  it('the side that holds the air interdicts, the side under it does not', () => {
    const sim = createSim(withNations(weakAir), fixtureScenario(weakAir, NATIONS.superpower, [0, 0, 10, 10]));
    sim.step(1);
    const st = sim.ctx.st;
    expect(st.airHolds).toEqual([false, true]);
    expect(st.interdiction[1]).toBeGreaterThan(0);
    expect(st.interdiction[0]).toBe(0);
  });
});

// a coast at lon 60 (fixture land ends there): Seaside holds the shore and has ships
const inland: NationSpec = {
  id: 'inland-1900', name: 'Inland', year: 1900, tech: 6, capital: { lat: 5, lon: 56 }, rect: [55, 0, 57, 10],
  forces: { infantry_line: 10000 },
};
const seaside: NationSpec = {
  id: 'seaside-1900', name: 'Seaside', year: 1900, tech: 6, capital: { lat: 5, lon: 58.5 }, rect: [57, 0, 60, 10],
  forces: { infantry_line: 10000, ships_major: 10 },
};
function coastSim() {
  const sim = createSim(withNations(inland, seaside), fixtureScenario(inland, seaside, [55, 0, 65, 10]));
  const { st } = sim.ctx;
  const F = st.F, g = sim.setup.grid;
  const own: number[] = [];
  for (let f = 0; f < F.n; f++) {
    if (F.side[f] === 1 && F.alive[f] && F.onMap[f]) own.push(f);
    else F.alive[f] = 0;               // only the two formations under test move
  }
  return { sim, st, F, g, own };
}

describe('SEA_LIFT_CHECKED_ON_ENTRY', () => {
  it('a formation with a cached sea step waits at the shore when the shipping is full', () => {
    const { sim, st, F, g, own } = coastSim();
    const ctx = sim.ctx;
    const shore = cellAt(g, 5.125, 59.875), sea = cellAt(g, 5.125, 60.125), afloat = cellAt(g, 5.125, 61.125);
    expect([g.land[shore], g.land[sea], g.land[afloat]]).toEqual([1, 0, 0]);
    const [a, b] = own;
    for (const f of own) if (f !== a && f !== b) F.alive[f] = 0;
    F.cell[a] = afloat; F.mode[a] = Mode.Hold;
    // lift for a and half of b: b no longer fits once a is at sea
    st.fleet[1][RI.ships_major] = 1;
    const perShip = seaLift(ctx, 1);
    st.fleet[1][RI.ships_major] = (seaLoad(ctx, a) + 0.5 * seaLoad(ctx, b)) / perShip;
    // b heads for the sea cell it chose on an earlier day, one step from boarding
    const n = g.n;
    st.objCells[1][0] = sea;
    const field = st.fields[1].subarray(0, n);
    field.fill(1000); field[sea] = 0; field[shore] = 1;
    F.cell[b] = shore; F.mode[b] = Mode.Attack; F.obj[b] = sea;
    F.next[b] = sea; F.edge[b] = 1e-3; F.prog[b] = 0;
    rebuildOccupancy(ctx);
    movementPhase(ctx);
    expect(F.cell[b]).toBe(shore);
    expect(F.next[b]).toBe(-1);
    expect(ctx.sc.embarked[1]).toBeLessThanOrEqual(seaLift(ctx, 1));
  });
});

describe('ATTACK_CONTACT_WITHOUT_BUDGET', () => {
  // the reviewer's repro on the real data: a battle case at lat 69.5 in January, 0 h of daylight
  const real = loadEngineData(new URL('../../public/data', import.meta.url).pathname);
  const r = (mid: number) => ({ low: mid, mid, high: mid });
  const T7 = { weapons: 7, armor: 7, logistics: 7, communications: 7, fortification: 7, ships: 7, isr: 7 };
  const polar = (lat: number, season: 'winter' | 'summer'): BattleCase => ({
    id: 'polar', name: 'polar', year: 1941, kind: 'battle', location: { lat, lon: 31, radiusKm: 10 }, terrain: 'forest', season,
    sides: [
      { name: 'A', posture: 'attack', forces: { infantry_line: r(20000) }, tech: T7 },
      { name: 'B', posture: 'defend', forces: { infantry_line: r(5000) }, tech: T7 },
    ],
    outcome: { winner: 0, durationDays: r(1), losses: [r(1), r(1)], note: '' }, sources: [], grade: 'D',
  } as unknown as BattleCase);
  it.each([[69.5, 'winter'], [-75, 'winter']] as const)('an attacker next to the enemy in polar night attacks (lat %s %s)', (lat, season) => {
    const x = battleCaseScenario(real, polar(lat, season), 1);
    const sim = createSim(x.data, x.scenario, x.opts);
    sim.step(1);
    const F = sim.ctx.st.F;
    const att = [...Array(F.n).keys()].find((f) => F.side[f] === 0)!;
    expect(dailyBudget(sim.ctx, att)).toBe(0);
    expect(sim.ctx.sc.battles.length).toBeGreaterThan(0);
    expect(runToEnd(sim).endReason).not.toContain('no contact');
  });
});

describe('CORNER_LAND_LINKS_CUT', () => {
  // two 2 x 2 land blocks that touch only at a corner: (0.5..1, 0..0.5) and (0..0.5, 0.5..1)
  function cornerTerrain(): ArrayBuffer {
    const N = GRID_W * GRID_H;
    const buf = new ArrayBuffer(N * 6);
    new Uint8Array(buf, 0, N).fill(T.water);
    const cls = new Uint8Array(buf, 0, N);
    for (const [lat, lon] of [[0.875, 0.125], [0.875, 0.375], [0.625, 0.125], [0.625, 0.375],
      [0.375, 0.625], [0.375, 0.875], [0.125, 0.625], [0.125, 0.875]]) cls[cellIndex(lat, lon)] = T.plains;
    return buf;
  }
  const g = buildGrid(globalTerrain(cornerTerrain()), [0, 0, 1, 1]);
  const a = cellAt(g, 0.625, 0.375), b = cellAt(g, 0.375, 0.625);
  it('marks the corner link both ways, and only it', () => {
    let marked = 0;
    for (let i = 0; i < g.n * 8; i++) marked += g.corner[i];
    expect(marked).toBe(2);
    expect(g.corner[a * 8 + 3]).toBe(1);   // SE
    expect(g.corner[b * 8 + 7]).toBe(1);   // NW
  });
  it('a land-only flow field does not reach the other block across the corner', () => {
    const inv = new Float32Array(g.n);
    for (let c = 0; c < g.n; c++) inv[c] = g.land[c] ? 1 : Infinity;
    const dist = new Float32Array(g.n);
    dijkstra(g, new Heap(16), inv, null, [cellAt(g, 0.875, 0.125)], null, dist, null);
    expect(dist[a]).toBeLessThan(Infinity);
    expect(dist[b]).toBe(Infinity);
  });
});
