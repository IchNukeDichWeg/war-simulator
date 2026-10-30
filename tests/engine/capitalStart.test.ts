import { describe, expect, it } from 'vitest';
import { createSim, runToEnd } from '../../src/engine/sim';
import type { EngineData } from '../../src/engine/protocol';
import { NATIONS, fixtureScenario, makeSnapshot, type NationSpec } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Red team C4: initial control came from overlapping border polygons with the nearer capital
// winning and side 0 winning a tie, so a capital inside the other side's polygon started
// enemy-held and "fell" on day 1 with no battle (Egypt 1274 BCE over Jerusalem, Rome 117 over
// Rome, the Aztecs over Mexico City).

// a big empire whose polygon covers a small state, and the small state's capital cell centre
// lies just outside its own polygon (Jerusalem's cell centre is in the West Bank)
const empire: NationSpec = {
  id: 'empire-1900', name: 'Empire', year: 1900, tech: 6, capital: { lat: 5, lon: 1 }, rect: [0, 0, 10, 10],
  forces: { infantry_line: 30000 },
};
const enclave: NationSpec = {
  id: 'enclave-1900', name: 'Enclave', year: 1900, tech: 6, capital: { lat: 5, lon: 9.6 }, rect: [6, 3, 9.5, 7],
  forces: { infantry_line: 30000 },
};
const rect = ([w, s, e, n]: [number, number, number, number]): number[][][][] => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
function withExtra(): EngineData {
  const d = data();
  return {
    ...d,
    snapshots: [...d.snapshots, makeSnapshot(empire), makeSnapshot(enclave)],
    borders: { ...d.borders, [empire.id]: rect(empire.rect), [enclave.id]: rect(enclave.rect) },
  };
}

describe('a capital inside the enemy polygon at the start', () => {
  it('belongs to its own side, and the overlap away from capitals is contested', () => {
    const sim = createSim(withExtra(), fixtureScenario(empire, enclave, [0, 0, 10, 10]));
    const S = sim.setup;
    const cap = S.members[1].capitalCell;
    expect(S.control0[cap]).toBe(1);
    // a cell both polygons cover, far from both capitals
    let mid = -1;
    for (let c = 0; c < S.grid.n; c++) if (Math.abs(S.grid.lat[c] - 5.125) < 0.01 && Math.abs(S.grid.lon[c] - 7.125) < 0.01) mid = c;
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(S.control0[mid]).toBe(255);
  });

  it.each([1, 2, 3])('is not captured on day 1 without an enemy formation on it (seed %i)', (seed) => {
    const sim = createSim(withExtra(), fixtureScenario(empire, enclave, [0, 0, 10, 10], { seed }));
    sim.step(1);
    expect(sim.ctx.st.members[1].capitalHeldDays).toBe(0);
    expect(sim.ended()).toBe(false);
  });
});

describe('two sides with the same capital', () => {
  // the chariot state and Westland share their polygon and capital (Rome 117 vs Italy 2026)
  const sc = (seed: number) => fixtureScenario(NATIONS.chariotState, NATIONS.westland, [0, 0, 10, 10], { seed });
  it('start with the capital contested and both garrisons in it', () => {
    const sim = createSim(data(), sc(1));
    const [a, b] = sim.setup.members;
    expect(a.capitalCell).toBe(b.capitalCell);
    expect(sim.setup.control0[a.capitalCell]).toBe(255);
    expect(sim.setup.seeds.some((s) => s.member === 0 && s.cell === a.capitalCell)).toBe(true);
    expect(sim.setup.seeds.some((s) => s.member === 1 && s.cell === a.capitalCell)).toBe(true);
  });
  it.each([1, 2, 3])('and the bronze-age side no longer wins by a day-1 capture (seed %i)', (seed) => {
    const r = runToEnd(createSim(data(), sc(seed)));
    // the bronze-age side used to win on day 1 by "capturing" Westland's capital
    expect(r.winner).not.toBe(0);
  });
});
