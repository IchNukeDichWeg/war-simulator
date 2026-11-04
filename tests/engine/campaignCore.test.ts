import { describe, expect, it } from 'vitest';
import { buildSetup } from '../../src/engine/setup';
import { createSim, simFromSetup } from '../../src/engine/sim';
import { battleCaseScenario } from '../../src/engine/battleCase';
import type { BattleCase } from '../../src/types/mechanics';
import { IS_P, NR } from '../../src/engine/roles';
import { NATIONS, fixtureScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Campaign-core accounting: sea lift, reinforcement timing, member collapse bookkeeping.

const r = (mid: number) => ({ low: mid, mid, high: mid });
const tech6 = { weapons: 6, armor: 6, logistics: 6, communications: 6, fortification: 6, ships: 6, isr: 6 };
// TEST FIXTURE, not data: a small campaign whose attacker gets reinforcements at elapsed days 0, 1, 1.5
const reinforcedCampaign: BattleCase = {
  id: 'fixture-reinforced', name: 'Fixture reinforced campaign', year: 1800, kind: 'campaign',
  location: { lat: 5, lon: 3, radiusKm: 150 }, bbox: [1.5, 4, 4.5, 6], terrain: 'plains', season: 'summer',
  sides: [
    { name: 'West', posture: 'attack', forces: { infantry_line: r(30000), artillery: r(60) }, tech: tech6,
      startPositions: [{ lat: 5, lon: 2.2, share: 1 }],
      reinforcements: [0, 1, 1.5].map((day, i) => ({ day, forces: { infantry_line: r(1000 * (i + 1)) } })) },
    { name: 'East', posture: 'defend', forces: { infantry_line: r(20000), artillery: r(40) }, tech: tech6,
      startPositions: [{ lat: 5, lon: 3.8, share: 1 }] },
  ],
  outcome: { winner: 0, durationDays: r(20), losses: [r(2000), r(5000)], note: 'TEST FIXTURE, not data' },
  sources: [], grade: 'D',
};

describe('backtest reinforcements count elapsed days (REINFORCEMENT_ELAPSED_DAYS)', () => {
  // Gettysburg's day-1.0 group arrived at round 0 of sim day 1, ahead of the 0.3 group
  it('arrive on sim day floor(day) + 1 at the round of the fraction', () => {
    const { data: d, scenario, opts } = battleCaseScenario(data(), reinforcedCampaign, 1);
    const sim = createSim(d, scenario, opts);
    const F = sim.ctx.st.F;
    const seen: string[] = [];
    for (let k = 0; k < 2 && !sim.ended(); k++) {
      const before = F.n;
      sim.step(1);
      for (let f = before; f < F.n; f++) seen.push(`${Math.round(F.startPersonnel[f])}@${sim.day()}r${F.joinDay[f] === sim.day() ? F.joinRound[f] : 0}`);
    }
    const H = sim.setup.H;
    expect(seen).toEqual(['1000@1r0', '2000@2r0', `3000@2r${Math.ceil(0.5 * H)}`]);
  });
});

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
