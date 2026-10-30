import { describe, expect, it } from 'vitest';
import { battleCaseScenario, runBattleCase } from '../../src/engine/battleCase';
import { createSim } from '../../src/engine/sim';
import { Mode } from '../../src/engine/state';
import type { BattleCase } from '../../src/types/mechanics';
import type { EngineData } from '../../src/engine/protocol';
import { data } from './helpers';

const r = (mid: number) => ({ low: mid, mid, high: mid });
const tech = (w: number) => ({ weapons: w, armor: w, logistics: 3, communications: 3, fortification: 3, ships: 3, isr: 3 });
const RAIDERS = 'fixture-raiders';

/** Fixture doctrines: side 0 withdraws at `threshold`, under the fixture era break 0.2 by default. */
function withRaiders(threshold = 0.1, pinRatio = 1): EngineData {
  const d = data();
  const mechanics = structuredClone(d.mechanics);
  mechanics.modelRules.battle.breakContactPinRatio = { ...mechanics.modelRules.battle.breakContactPinRatio, mid: pinRatio };
  const base = d.doctrines[0];
  return { ...d, mechanics, doctrines: [...d.doctrines, { ...base, id: RAIDERS, weights: { ...base.weights, retreatThreshold: threshold } }] };
}

// TEST FIXTURE, not data: a mounted raider force against a slower army with a small cavalry screen
const raid = (over: { raiders?: BattleCase['sides'][0]['forces']; army?: BattleCase['sides'][0]['forces'] } = {}): BattleCase => ({
  id: 'fixture-raid', name: 'Fixture raid', year: -53, kind: 'battle',
  location: { lat: 5, lon: 3, radiusKm: 10 }, terrain: 'plains', season: 'summer',
  sides: [
    { name: 'Raiders', posture: 'attack', forces: over.raiders ?? { cavalry_light: r(10000) }, tech: tech(3), doctrineId: RAIDERS, morale: 0.8, training: 0.9 },
    { name: 'Army', posture: 'defend', forces: over.army ?? { infantry_line: r(20000), cavalry_light: r(2000) }, tech: tech(3), morale: 0.5, training: 0.5 },
  ],
  outcome: { winner: 0, durationDays: r(5), losses: [r(500), r(5000)], note: 'TEST FIXTURE, not data' },
  sources: [], grade: 'D',
});

// TEST FIXTURE, not data: the same forces in a small war-mode theater
const raidCampaign = (): BattleCase => {
  const bc = raid({ army: { infantry_line: r(60000), cavalry_light: r(2000) } });
  return {
    ...bc, id: 'fixture-raid-campaign', kind: 'campaign', location: { ...bc.location, radiusKm: 150 }, bbox: [1.5, 4, 4.5, 6],
    outcome: { ...bc.outcome, durationDays: r(30) },
    sides: [
      // the army is big enough for the AI to staff the attack: at 20,000 both sides stand and defend
      { ...bc.sides[0], posture: 'defend', startPositions: [{ lat: 5, lon: 2.95, share: 1 }] },
      { ...bc.sides[1], posture: 'attack', startPositions: [{ lat: 5, lon: 3.05, share: 1 }], objective: { name: 'Raiders', lat: 5, lon: 2.95, kind: 'destroy', radiusKm: 60 } },
    ],
  };
};

function runSim(d: EngineData, bc: BattleCase, seed = 1) {
  const { data: d2, scenario, opts } = battleCaseScenario(d, bc, seed);
  const sim = createSim(d2, scenario, { ...opts, breakpointQuantile: 0.5 });
  const sideNames = sim.setup.sideNames;
  const log: { day: number; left: boolean; beat: boolean }[] = [];
  const modes: number[][] = [];
  while (!sim.ended()) {
    sim.step(1);
    const F = sim.ctx.st.F;
    const row: number[] = [];
    for (let f = 0; f < F.n; f++) if (F.alive[f] && F.side[f] === 0) row.push(F.mode[f]);
    modes.push(row);
  }
  for (const e of sim.ctx.st.events) log.push({ day: e.day, left: e.text.includes('broke contact'), beat: e.text.includes(`beat ${sideNames[0]}`) });
  return { sim, log, modes, result: sim.result()! };
}

describe('breaking contact intact (BREAK_CONTACT_INTACT)', () => {
  it('a mobile side that withdraws at its doctrine threshold is not beaten and takes no pursuit', () => {
    const { log, result } = runSim(withRaiders(), raid());
    const left = log.find((e) => e.left);
    expect(left).toBeDefined();
    expect(log.some((e) => e.beat && e.day === left!.day)).toBe(false);
    expect(result.stats[0].lossesByCause.pursuit).toBe(0);
    expect(result.stats[0].lossesByCause.captured).toBe(0);
  });

  it('it comes back: the next day the formations are not withdrawing and fight again', () => {
    const { log, modes, sim } = runSim(withRaiders(), raid());
    const day = log.find((e) => e.left)!.day;
    expect(modes[day - 1].every((m) => m === Mode.Retreat)).toBe(true);
    expect(sim.ctx.st.day).toBeGreaterThan(day);
    expect(modes[day].some((m) => m !== Mode.Retreat)).toBe(true);
  });

  it('the fight goes on to the era break: losses are cumulative inside the battle', () => {
    // a small force against a much stronger army: leaving does not save it for ever
    const bc = raid({ raiders: { cavalry_light: r(3000) }, army: { infantry_line: r(60000), cavalry_light: r(1000) } });
    const { log, result } = runSim(withRaiders(), bc);
    expect(log.some((e) => e.left)).toBe(true);
    expect(result.winner).toBe(1);
  });

  it('an enemy with the mobile strength to pin it gets the old result: a defeat with pursuit', () => {
    const bc = raid({ army: { infantry_line: r(20000), cavalry_light: r(12000) } });
    const { log, result } = runSim(withRaiders(), bc);
    expect(log.some((e) => e.left)).toBe(false);
    expect(result.winner).toBe(1);
    expect(result.stats[0].lossesByCause.pursuit + result.stats[0].lossesByCause.captured).toBeGreaterThan(0);
  });

  it('the pin ratio comes from the data: at 0.1 the same screen pins the raiders', () => {
    expect(runSim(withRaiders(0.1, 1), raid()).log.some((e) => e.left)).toBe(true);
    expect(runSim(withRaiders(0.1, 0.1), raid()).log.some((e) => e.left)).toBe(false);
  });

  it('foot in the formation cannot leave, whatever the doctrine', () => {
    const bc = raid({ raiders: { cavalry_light: r(9000), infantry_line: r(1000) } });
    expect(runSim(withRaiders(), bc).log.some((e) => e.left)).toBe(false);
  });

  it('a doctrine that holds to the era break does not leave by choice', () => {
    expect(runSim(withRaiders(0.2), raid()).log.some((e) => e.left)).toBe(false);
  });

  it('a side with enemy air support is pinned', () => {
    const bc = raid({ army: { infantry_line: r(20000), cavalry_light: r(2000), aircraft_strike: r(100) } });
    bc.sides[1].tech = { ...tech(3), air: 8 };
    expect(runSim(withRaiders(), bc).log.some((e) => e.left)).toBe(false);
  });

  it('war mode: the side falls back, no battle is booked as lost', () => {
    const { sim, log } = runSim(withRaiders(), raidCampaign());
    expect(log.some((e) => e.left)).toBe(true);
    const F = sim.ctx.st.F;
    let alive = 0;
    for (let f = 0; f < F.n; f++) if (F.alive[f] && F.side[f] === 0) alive++;
    expect(alive).toBeGreaterThan(0);
    expect(sim.ctx.st.acc.battleWins[1]).toBe(0);
  });

  it('is deterministic', () => {
    const a = runBattleCase(withRaiders(), raid(), 3);
    const b = runBattleCase(withRaiders(), raid(), 3);
    expect(a.winner).toBe(b.winner);
    expect(a.losses).toEqual(b.losses);
    expect(a.durationDays).toBe(b.durationDays);
  });
});
