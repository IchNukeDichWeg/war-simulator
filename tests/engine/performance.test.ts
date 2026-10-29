import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/engine/sim';
import { perfScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

describe('performance', () => {
  it('advances a day with >= 2000 formations per side in reasonable time', () => {
    const sim = createSim(data(), perfScenario(1));
    const F = sim.ctx.st.F;
    const n: [number, number] = [0, 0];
    for (let f = 0; f < F.n; f++) if (F.alive[f]) n[F.side[f]]++;
    expect(n[0]).toBeGreaterThanOrEqual(2000);
    expect(n[1]).toBeGreaterThanOrEqual(2000);
    sim.step(5);                                  // warm-up (JIT)
    const days = 40;
    let battles = 0;
    const t0 = performance.now();
    for (let d = 0; d < days && !sim.ended(); d++) { sim.step(); battles += sim.ctx.sc.battles.length; }
    const msPerDay = (performance.now() - t0) / days;
    console.log(`perf: ${n[0]} + ${n[1]} formations, ${msPerDay.toFixed(1)} ms/day over ${days} days, ${battles} battle-days`);
    expect(msPerDay).toBeLessThan(250);
  });
});
