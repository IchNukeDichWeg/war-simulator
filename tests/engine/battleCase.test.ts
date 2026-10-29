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

// TEST FIXTURE, not data: a small campaign where side 0's capture objective sits in its own start area
const tech6 = { weapons: 6, armor: 6, logistics: 6, communications: 6, fortification: 6, ships: 6, isr: 6 };
const fixtureCampaign = (objective: NonNullable<BattleCase['sides'][0]['objective']>): BattleCase => ({
  id: 'fixture-campaign', name: 'Fixture campaign', year: 1800, kind: 'campaign',
  location: { lat: 5, lon: 3, radiusKm: 150 }, bbox: [1.5, 4, 4.5, 6], terrain: 'plains', season: 'summer',
  sides: [
    { name: 'West', posture: 'attack', forces: { infantry_line: r(30000), artillery: r(60) }, tech: tech6,
      startPositions: [{ lat: 5, lon: 2.2, share: 1 }], objective },
    { name: 'East', posture: 'defend', forces: { infantry_line: r(20000), artillery: r(40) }, tech: tech6,
      startPositions: [{ lat: 5, lon: 3.8, share: 1 }] },
  ],
  outcome: { winner: 0, durationDays: r(20), losses: [r(2000), r(5000)], note: 'TEST FIXTURE, not data' },
  sources: [], grade: 'D',
});

describe('campaign objectives', () => {
  it('a capture objective in own control at the start warns and is never "taken"', () => {
    const res = runBattleCase(data(), fixtureCampaign({ name: 'Home', lat: 5, lon: 2.2, kind: 'capture' }), 1);
    expect(res.warnings.some((w) => /capture objective Home is in its own control/.test(w))).toBe(true);
    expect(res.result.endReason).not.toMatch(/took its objective/);
  });
  it('a destroy objective targets the enemy inside its radius and needs radiusKm', () => {
    const none = runBattleCase(data(), fixtureCampaign({ name: 'Pocket', lat: 5, lon: 3.8, kind: 'destroy' }), 1);
    expect(none.warnings.some((w) => /destroy objective Pocket has no radiusKm/.test(w))).toBe(true);
    const res = runBattleCase(data(), fixtureCampaign({ name: 'Pocket', lat: 5, lon: 3.8, kind: 'destroy', radiusKm: 60 }), 1);
    expect(res.warnings.some((w) => /no enemy formation within/.test(w))).toBe(false);
    if (/objective/.test(res.result.endReason)) expect(res.result.endReason).toMatch(/destroyed the enemy force/);
  });
});
