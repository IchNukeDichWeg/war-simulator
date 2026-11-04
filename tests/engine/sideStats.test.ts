import { describe, expect, it } from 'vitest';
import { buildSetup } from '../../src/engine/setup';
import { simFromSetup } from '../../src/engine/sim';
import { sideStats } from '../../src/engine/frame';
import { NATIONS, fixtureScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

describe('side readout while an army marches in', () => {
  // Rome vs Spain 2026 showed Rome at 0% morale for its first 28 days: none of its 90 formations
  // was on the map yet, and the readout averaged on-map formations only
  it('reports the marching formations instead of zero', () => {
    const sim = simFromSetup(buildSetup(data(), fixtureScenario(NATIONS.westland, NATIONS.eastland, [0, 0, 10, 10])), 1);
    const { F } = sim.ctx.st;
    let m = 0, s = 0, w = 0;
    for (let f = 0; f < F.n; f++) {
      if (!F.alive[f] || F.side[f] !== 0) continue;
      F.onMap[f] = 0;
      m += F.morale[f] * F.curW[f]; s += F.supply[f] * F.curW[f]; w += F.curW[f];
    }
    expect(w).toBeGreaterThan(0);
    const st = sideStats(sim.ctx, 0);
    expect(st.morale).toBeCloseTo(m / w, 9);
    expect(st.supply).toBeCloseTo(s / w, 9);
    expect(st.morale).toBeGreaterThan(0);
  });
});
