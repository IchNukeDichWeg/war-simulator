import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/engine/sim';
import { maxDailyKm } from '../../src/engine/movement';
import { NR } from '../../src/engine/roles';
import { absurdScenario, basicScenario } from '../fixtures/snapshots.fixture';
import { data, personnelNow, totalLosses } from './helpers';

const scenarios = [['basic', basicScenario(3)], ['absurd', absurdScenario(3)]] as const;

describe.each(scenarios)('invariants (%s)', (_name, scenario) => {
  it('no negative strength, ratings stay in 0..1, movement within the daily maximum, personnel conserved', () => {
    const sim = createSim(data(), scenario);
    const { st } = sim.ctx;
    const start: [number, number] = [personnelNow(sim, 0), personnelNow(sim, 1)];
    expect(start[0]).toBeCloseTo(st.startPersonnel[0], 3);
    expect(start[1]).toBeCloseTo(st.startPersonnel[1], 3);
    let worstMove = 0, battles = 0;
    for (let d = 0; d < 400 && !sim.ended(); d++) {
      sim.step();
      battles += sim.ctx.sc.battles.length;
      const F = st.F;
      for (let f = 0; f < F.n; f++) {
        if (!F.alive[f]) continue;
        expect(F.personnel[f]).toBeGreaterThanOrEqual(0);
        expect(F.curW[f]).toBeGreaterThanOrEqual(0);
        for (let r = 0; r < NR; r++) expect(F.counts[f * NR + r]).toBeGreaterThanOrEqual(0);
        expect(F.morale[f]).toBeGreaterThanOrEqual(0);
        expect(F.morale[f]).toBeLessThanOrEqual(1);
        expect(F.supply[f]).toBeGreaterThanOrEqual(0);
        expect(F.supply[f]).toBeLessThanOrEqual(1);
        if (F.onMap[f]) {
          const lim = maxDailyKm(sim.ctx, f);
          expect(F.movedKm[f]).toBeLessThanOrEqual(lim);
          worstMove = Math.max(worstMove, F.movedKm[f] / lim);
        }
      }
      // start + arrivals = current + losses by cause + in hospital (due back to duty)
      for (const s of [0, 1] as const) {
        const lhs = st.startPersonnel[s] + st.arrivals[s];
        const rhs = personnelNow(sim, s) + totalLosses(sim, s) + st.hospital[s];
        expect(Math.abs(lhs - rhs)).toBeLessThan(1e-6 * Math.max(1, lhs));
        expect(st.hospital[s]).toBeGreaterThanOrEqual(-1e-6 * Math.max(1, lhs));
      }
      // reported casualties are exactly the sum of losses by cause
      if (d % 25 === 0) {
        const fr = sim.frame(false);
        for (const s of [0, 1] as const) {
          const byCause = Object.values(fr.stats[s].lossesByCause).reduce((a, b) => a + b, 0);
          expect(Math.abs(fr.stats[s].casualties - byCause)).toBeLessThan(1e-6 * Math.max(1, byCause));
        }
      }
      for (const s of [0, 1] as const) for (const v of st.losses[s]) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(sim.ended()).toBe(true);
    expect(worstMove).toBeGreaterThan(0);   // formations did move
    void battles;
  });
});
