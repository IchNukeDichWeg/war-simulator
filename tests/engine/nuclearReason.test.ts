import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/engine/sim';
import { LC } from '../../src/engine/roles';
import { basicScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Red team W7: explain() had no nuclear factor, so 740k nuclear casualties that decided Russia vs
// USA 2026 never showed in the ranked reasons.
describe('outcome reasons', () => {
  it('rank nuclear losses like the other loss factors', () => {
    const sim = createSim(data(), basicScenario(1));
    sim.step(10);
    const st = sim.ctx.st;
    const fielded = st.startPersonnel[1] + st.arrivals[1];
    // side 1 lost half of what it fielded to nuclear strikes, side 0 nothing
    st.losses[1][LC.nuclear] = 0.5 * fielded;
    const r = sim.result(true)!;
    const nuc = r.reasons.find((x) => x.factor === 'Nuclear strikes');
    expect(nuc).toBeDefined();
    expect(nuc!.side).toBe(0);
    expect(nuc!.weight).toBeGreaterThan(0.01);
    expect(nuc!.detail).toContain('nuclear');
  });
  it('list nuclear losses even when their weight is under the 1% cut', () => {
    // Russia vs USA 2026 (red team W7): 123,672 Russian nuclear casualties weighed under 1%
    // next to "Numbers" and dropped out of the reasons
    const sim = createSim(data(), basicScenario(1));
    sim.step(10);
    const st = sim.ctx.st;
    st.losses[1][LC.nuclear] = 1e-4 * (st.startPersonnel[1] + st.arrivals[1]);
    const nuc = sim.result(true)!.reasons.find((x) => x.factor === 'Nuclear strikes');
    expect(nuc).toBeDefined();
    expect(nuc!.side).toBe(0);
    // the weight stays honest: listed, not inflated
    expect(nuc!.weight).toBeLessThan(0.01);
  });
  it('leave the factor out when no warhead was used', () => {
    const sim = createSim(data(), basicScenario(1));
    sim.step(10);
    expect(sim.result(true)!.reasons.some((x) => x.factor === 'Nuclear strikes')).toBe(false);
  });
});
