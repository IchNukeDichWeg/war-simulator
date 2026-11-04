import { describe, expect, it } from 'vitest';
import { buildSetup } from '../../src/engine/setup';
import { simFromSetup } from '../../src/engine/sim';
import { IS_P, NR } from '../../src/engine/roles';
import { NATIONS, fixtureScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Campaign-core accounting: sea lift, reinforcement timing, member collapse bookkeeping.

describe('sea lift shared by the seed waves and the depot (SEA_LIFT_AFTER_SEED_WAVES)', () => {
  // NATO 1989: the US landed 260k on day 9 from its seed waves, then shipped a second full lift
  // of depot troops on day 12 although the round trip is 16.2 days
  it('ships depot troops only one round trip after the last seed wave', () => {
    const S = buildSetup(data(), fixtureScenario(NATIONS.westland, NATIONS.eastland, [0, 0, 10, 10]));
    const mr = S.members[1];
    mr.entryBySea = true;
    mr.lift = 1e9;
    mr.roundTripDays = 10;
    for (const sd of S.seeds) if (sd.member === mr.idx) sd.arriveDay = 0;
    const sim = simFromSetup(S, 1);
    const { st } = sim.ctx;
    // last seed wave on day 0, round trip 10 days
    expect(st.nextLiftDay[mr.idx]).toBe(10);
    expect(st.nextLiftDay[0]).toBe(0);
    // a full formation of depot troops waits for the lift
    const F = st.F;
    const before = F.n;
    for (let r = 0; r < NR; r++) if (IS_P[r]) st.members[mr.idx].depot[r] += 3 * mr.formationSize * mr.pMix[r];
    sim.step(9);
    let spawned = 0;
    for (let f = before; f < F.n; f++) if (F.member[f] === mr.idx) spawned++;
    expect(spawned).toBe(0);
    sim.step(1);
    for (let f = before; f < F.n; f++) if (F.member[f] === mr.idx) spawned++;
    expect(spawned).toBeGreaterThan(0);
  });
});
