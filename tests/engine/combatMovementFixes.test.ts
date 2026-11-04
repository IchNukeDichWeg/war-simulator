import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/engine/sim';
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
