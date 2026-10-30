import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eraOfYear, rule, ruleMV, validateMechanics } from '../../src/engine/mech';
import { fixtureMechanics, mv } from '../fixtures/mechanics.fixture';
import type { EraRule, MV } from '../../src/types/mechanics';
import { createSim } from '../../src/engine/sim';
import { WITHDRAW_SHARE_OF_BREAKPOINT } from '../../src/engine/constants';
import { basicScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

describe('model rules', () => {
  const r: EraRule = { iron: mv(1), medieval: mv(2), gunpowder: mv(3), napoleonic: mv(4), industrial: mv(5), modern: mv(9) };
  it('picks napoleonic for 1789-1849 when present, else the ERA_SPANS era', () => {
    expect(rule(r, -480)).toBe(1);
    expect(rule(r, 1788)).toBe(3);
    expect(rule(r, 1789)).toBe(4);
    expect(rule(r, 1849)).toBe(4);
    expect(rule(r, 1850)).toBe(5);
    expect(rule({ industrial: mv(5) }, 1815)).toBe(5);
    expect(rule(r, 2026)).toBe(9);
  });
  it('clamps years outside the spans and reports absent eras', () => {
    expect(eraOfYear(-5000)).toBe('bronze');
    expect(eraOfYear(2100)).toBe('modern');
    expect(ruleMV(r, 1940)).toBeUndefined();
    expect(rule(r, 1940, -1)).toBe(-1);
    expect(rule(mv(0.25), 1940)).toBe(0.25);
  });
  it('the fixture and the built runtime data both validate', () => {
    expect(validateMechanics(fixtureMechanics())).toEqual([]);
    const built = JSON.parse(readFileSync(new URL('../../public/data/mechanics.json', import.meta.url), 'utf8'));
    expect(validateMechanics(built)).toEqual([]);
  });
});

describe('battle breakpoint draw', () => {
  // fixture breakpoint: low 0.1, mid 0.2, high 0.4 in every era
  const withRange = () => {
    const d = data();
    const m = structuredClone(d.mechanics);
    for (const e of Object.keys(m.modelRules.breakpoint.loserCasualtyShareAtBreak)) {
      (m.modelRules.breakpoint.loserCasualtyShareAtBreak as Record<string, MV>)[e] = mv(0.2, 0.1, 0.4);
    }
    return { ...d, mechanics: m };
  };
  // SYMMETRIC_DOCTRINE_BREAKPOINT: break = doctrine retreatThreshold x bp_era(u) / bp_era(mid) + cohesion shift
  const bps = (sim: ReturnType<typeof createSim>) => sim.ctx.st.members.map((ms, i) => (ms.breakpoint - sim.setup.members[i].bpShift) / sim.setup.members[i].retreatThreshold);
  it('a fixed quantile scales the doctrine threshold by low, mid and high over mid', () => {
    const d = withRange();
    for (const [q, v] of [[0, 0.1], [0.5, 0.2], [1, 0.4]] as const) {
      for (const b of bps(createSim(d, basicScenario(3), { breakpointQuantile: q }))) expect(b).toBeCloseTo(v / 0.2, 12);
    }
  });
  it('withdrawal comes at WITHDRAW_SHARE_OF_BREAKPOINT of the break, also for a high threshold', () => {
    const d = withRange();
    const sim = createSim(d, basicScenario(3), { breakpointQuantile: 1 });
    for (const ms of sim.ctx.st.members) expect(ms.retreat).toBeCloseTo(WITHDRAW_SHARE_OF_BREAKPOINT * ms.breakpoint, 12);
  });
  it('the per-seed draw stays in range, repeats per seed and varies across seeds', () => {
    const d = withRange();
    const draws = [1, 2, 3, 4, 5, 6].map((s) => bps(createSim(d, basicScenario(s)))[0]);
    for (const b of draws) { expect(b).toBeGreaterThanOrEqual(0.5 - 1e-12); expect(b).toBeLessThanOrEqual(2 + 1e-12); }
    expect(bps(createSim(d, basicScenario(4)))[0]).toBe(draws[3]);
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});
