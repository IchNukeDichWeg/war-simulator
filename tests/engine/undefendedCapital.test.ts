import { describe, expect, it } from 'vitest';
import { createSim, runToEnd } from '../../src/engine/sim';
import type { EngineData } from '../../src/engine/protocol';
import { NATIONS, fixtureScenario, makeSnapshot, type NationSpec } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Red team W5: a state with no army (Andorra, Costa Rica, Iceland) was never taken. Its capital
// cell started neutral when the state is smaller than a cell (no polygon cell centre), so it was
// neither an AI objective nor capturable; and an empty fortified capital still had to be besieged
// for daysToReduce, which an attacker at the end of its supply line never finished.

// no forces, a polygon too small to hold a cell centre, capital on open land east of Westland
const micro: NationSpec = {
  id: 'microstate-1900', name: 'Microstate', year: 1900, tech: 6, capital: { lat: 5.05, lon: 6.05 }, rect: [6.0, 5.0, 6.1, 5.1],
  forces: {},
};
const rect = ([w, s, e, n]: [number, number, number, number]): number[][][][] => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
function withMicro(spec: NationSpec = micro): EngineData {
  const d = data();
  return { ...d, snapshots: [...d.snapshots, makeSnapshot(spec)], borders: { ...d.borders, [spec.id]: rect(spec.rect) } };
}

describe('a state with no army', () => {
  it('holds its capital cell at the start although no polygon cell centre is its own', () => {
    const sim = createSim(withMicro(), fixtureScenario(NATIONS.westland, micro, [0, 0, 10, 10]));
    const m = sim.setup.members[1];
    expect(m.capitalCell).toBeGreaterThanOrEqual(0);
    expect(sim.setup.control0[m.capitalCell]).toBe(1);
  });

  it.each([1, 2, 3])('loses its capital to the first enemy formation that reaches it, without a siege (seed %i)', (seed) => {
    const sim = createSim(withMicro(), fixtureScenario(NATIONS.westland, micro, [0, 0, 10, 10], { seed }));
    const r = runToEnd(sim);
    expect(r.winner).toBe(0);
    expect(r.endReason).toContain('capital');
    expect(sim.ctx.st.events.some((e) => e.kind === 'siege')).toBe(false);
  });

  it('gets a setup warning when its capital lies outside the theater', () => {
    const far = { ...micro, id: 'farstate-1900', name: 'Farstate', capital: { lat: 5.05, lon: 30 }, rect: [29.9, 5, 30.1, 5.1] as [number, number, number, number] };
    const sim = createSim(withMicro(far), fixtureScenario(NATIONS.westland, far, [0, 0, 10, 10]));
    expect(sim.setup.warnings.some((w) => w.includes('Farstate') && w.includes('cannot lose by capital capture'))).toBe(true);
  });
});
