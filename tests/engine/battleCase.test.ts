import { describe, expect, it } from 'vitest';
import { runBattleCase } from '../../src/engine/battleCase';
import type { BattleCase } from '../../src/types/mechanics';
import { data } from './helpers';

const r = (mid: number) => ({ low: mid, mid, high: mid });
// TEST FIXTURE, not data: a synthetic open-field battle between two tech-6 armies
const fixtureBattle: BattleCase = {
  id: 'fixture-field', name: 'Fixture field battle', year: 1800, kind: 'battle',
  location: { lat: 5, lon: 3, radiusKm: 10 }, terrain: 'plains', season: 'summer',
  sides: [
    { name: 'Big', posture: 'attack', forces: { infantry_line: r(30000), cavalry_light: r(3000), artillery: r(60) }, tech: { weapons: 6, armor: 6, logistics: 6, communications: 6, fortification: 6, ships: 6, isr: 6 } },
    { name: 'Small', posture: 'defend', forces: { infantry_line: r(10000), artillery: r(20) }, tech: { weapons: 6, armor: 6, logistics: 6, communications: 6, fortification: 6, ships: 6, isr: 6 } },
  ],
  outcome: { winner: 0, durationDays: r(0.5), losses: [r(2000), r(5000)], note: 'TEST FIXTURE, not data' },
  sources: [], grade: 'D',
};

describe('runBattleCase', () => {
  it('returns winner, fractional duration and losses, deterministically', () => {
    const a = runBattleCase(data(), fixtureBattle, 1);
    const b = runBattleCase(data(), fixtureBattle, 1);
    expect(a.winner).toBe(b.winner);
    expect(a.losses).toEqual(b.losses);
    expect(a.durationDays).toBeGreaterThan(0);
    expect(a.durationDays).toBeLessThanOrEqual(3);
    expect(a.losses[0]).toBeGreaterThan(0);
    expect(a.losses[1]).toBeGreaterThan(0);
    expect(a.winner).toBe(0);                      // 3:1 in the open
  });
});
