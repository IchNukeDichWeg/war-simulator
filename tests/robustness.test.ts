import { describe, expect, it } from 'vitest';
import { constantTasks, margin, summarize, withMid } from '../scripts/lib/robustness';

const mv = (low: number, mid: number, high: number, grade = 'D') => ({ low, mid, high, grade, source: 's', note: 'n' });

describe('robustness screen', () => {
  it('moves grade-D constants with a range to each end that differs from the mid', () => {
    const keys = constantTasks({
      a: { d: mv(1, 2, 3), c: mv(1, 2, 3, 'C'), flat: mv(2, 2, 2), oneSided: mv(1, 2, 2) },
      list: [mv(0, 1, 2)],
      modelRules: { breakpoint: { iron: mv(0.1, 0.2, 0.3) } },
    }).map((t) => t.key);
    expect(keys).toEqual(['a.d=low', 'a.d=high', 'a.oneSided=low', 'list.0=low', 'list.0=high']);
  });

  it('replaces one mid in a copy and leaves the original alone', () => {
    const o = { a: [mv(1, 2, 3)], b: mv(4, 5, 6) };
    const c = withMid(o, ['a', '0'], 9) as typeof o;
    expect(c.a[0].mid).toBe(9);
    expect(o.a[0].mid).toBe(2);
    expect(Array.isArray(c.a)).toBe(true);
    expect(c.b).toBe(o.b);
  });

  it('counts a case robust only if no constant takes it under the line', () => {
    const base = { key: 'BASE', pct: { keep: 0.9, flips: 0.7, bpOnly: 0.8, under: 0.3 } };
    const s = summarize(base, [
      { key: 'x=low', pct: { keep: 0.8, flips: 0.59, bpOnly: 0.8 } },
      { key: 'x=high', pct: { keep: 0.9, flips: 0.2, bpOnly: 0.8 } },
      { key: 'breakpoint=1', pct: { keep: 0.9, flips: 0.9, bpOnly: 0.1 } },
    ], 200);
    expect(s.passing).toEqual(['keep', 'flips', 'bpOnly']);
    expect(s.robust).toEqual(['keep', 'bpOnly']);
    expect(s.robustWithBreakpoints).toEqual(['keep']);
    expect(s.flips.find((f) => f.key === 'x=low')!.clear).toBe(false);
    expect(s.flips.find((f) => f.key === 'x=high')!.clear).toBe(true);
  });

  it('gives about +/- 7% at the line at 200 seeds', () => {
    expect(margin(0.6, 200)).toBeCloseTo(0.068, 2);
  });
});
