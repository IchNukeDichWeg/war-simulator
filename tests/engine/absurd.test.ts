import { describe, expect, it } from 'vitest';
import { createSim, runToEnd } from '../../src/engine/sim';
import { absurdScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

describe('absurd pairing: bronze-age chariot state vs 2026 superpower', () => {
  it.each([1, 2, 3])('seed %i runs to an end with an explanation', (seed) => {
    const sim = createSim(data(), absurdScenario(seed));
    const r = runToEnd(sim);
    expect(r.endDay).toBeLessThanOrEqual(absurdScenario().victory.timeLimitDays);
    expect(r.endReason.length).toBeGreaterThan(0);
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const x of r.reasons) {
      expect(x.detail.length).toBeGreaterThan(0);
      expect(x.weight).toBeGreaterThanOrEqual(0);
    }
    for (const s of r.stats) {
      expect(s.personnel).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.casualties)).toBe(true);
    }
    // the bronze-age side cannot win this
    expect(r.winner).not.toBe(0);
  });
});
