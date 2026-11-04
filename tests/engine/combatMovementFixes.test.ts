import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/engine/sim';
import { rebuildOccupancy } from '../../src/engine/ctx';
import { cellAt } from '../../src/engine/grid';
import { movementPhase, seaLift, seaLoad } from '../../src/engine/movement';
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
