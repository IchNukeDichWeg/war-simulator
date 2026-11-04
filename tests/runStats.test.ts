import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/engine/protocol';
import { deltaOver, endReasonBreakdown, EVENT_GROUPS, filterEvents, groupCounts, groupOf, histogram, indexAtOrBefore, outcomeCounts, peakOf, share, splitLosses, wilson } from '../src/ui/runStats';

describe('Monte Carlo summaries', () => {
  it('matches published Wilson 95% intervals', () => {
    // reference values: Newcombe (1998), Table I, and the closed form at z = 1.96
    const a = wilson(50, 100);
    expect(a.p).toBe(0.5);
    expect(a.lo).toBeCloseTo(0.4038, 4);
    expect(a.hi).toBeCloseTo(0.5962, 4);
    const b = wilson(81, 263);
    expect(b.lo).toBeCloseTo(0.2553, 4);
    expect(b.hi).toBeCloseTo(0.3662, 4);
  });

  it('stays inside [0, 1] and is non-degenerate at 0 and n successes', () => {
    const z = wilson(0, 10);
    expect(z.lo).toBe(0);
    expect(z.hi).toBeCloseTo(0.2775, 4);
    const all = wilson(10, 10);
    expect(all.hi).toBe(1);
    expect(all.lo).toBeCloseTo(0.7225, 4);
  });

  it('narrows with more runs (four times the runs roughly halves it)', () => {
    const w = (n: number) => { const r = wilson(n / 2, n); return r.hi - r.lo; };
    expect(w(800) / w(200)).toBeCloseTo(0.5, 1);
  });

  it('handles an empty batch without NaN', () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it('counts outcomes from the runs, or from the probabilities when runs are missing', () => {
    const results = [{ winner: 0 as const }, { winner: 1 as const }, { winner: 0 as const }, { winner: 'draw' as const }];
    expect(outcomeCounts({ runs: 4, winProb: [0.5, 0.25, 0.25], results })).toEqual([2, 1, 1]);
    expect(outcomeCounts({ runs: 200, winProb: [0.6, 0.3, 0.1], results: [] })).toEqual([120, 60, 20]);
  });

  it('bins integer days into integer-aligned bins that hold every run', () => {
    const days = [10, 11, 12, 15, 20, 20, 39];
    const h = histogram(days, 6);
    expect(h.lo).toBe(10);
    expect(Number.isInteger(h.width)).toBe(true);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(days.length);
    expect(h.lo + h.width * h.counts.length - 1).toBeGreaterThanOrEqual(39);
    expect(histogram([5, 5, 5]).counts).toEqual([3]);
    expect(histogram([]).counts).toEqual([]);
  });

  it('groups end reasons that differ only in their numbers', () => {
    const rs = [
      { winner: 0 as const, endReason: "time limit; holds 45% of the enemy's territory vs 10%" },
      { winner: 0 as const, endReason: "time limit; holds 52% of the enemy's territory vs 3%" },
      { winner: 1 as const, endReason: 'Rome broke' },
      { winner: 'draw' as const, endReason: 'time limit' },
    ];
    const b = endReasonBreakdown(rs);
    expect(b[0]).toEqual({ winner: 0, reason: "time limit; holds N% of the enemy's territory vs N%", count: 2 });
    expect(b).toHaveLength(3);
  });

  it('keeps a reason verbatim when every run in its group gave the same text', () => {
    const same = 'Rome\'s army collapsed (personnel below 50% of all it fielded)';
    const b = endReasonBreakdown([{ winner: 1 as const, endReason: same }, { winner: 1 as const, endReason: same }]);
    expect(b).toEqual([{ winner: 1, reason: same, count: 2 }]);
  });
});

const ev = (day: number, kind: SimEvent['kind'], side: SimEvent['side'], text: string, why?: string): SimEvent => ({ day, kind, side, text, why });

describe('event log filter', () => {
  const log: SimEvent[] = [
    ev(1, 'mobilization', 0, 'Rome mobilized 20,000 reservists.'),
    ev(3, 'battle', 0, 'Rome won a battle at Toletum.', 'Tech gap x3'),
    ev(5, 'capture', 1, 'Spain took Gades.'),
    ev(6, 'weather', -1, 'Mud slows movement across the theater.'),
    ev(8, 'naval', 1, 'Fleet action: Rome lost 2 ships.'),
    ev(9, 'capture', 0, 'Spain lost its capital Madrid.', 'Morale shock'),
    ev(12, 'end', 0, 'Rome won: Spain broke.'),
  ];
  const all = { groups: new Set<never>(), side: '' as const, query: '' };

  it('assigns every engine event kind to exactly one group', () => {
    const kinds: SimEvent['kind'][] = ['battle', 'rout', 'siege', 'capture', 'supply', 'naval', 'air', 'mobilization', 'arrival', 'nuclear', 'weather', 'end'];
    for (const k of kinds) expect(groupOf(k), k).toBeDefined();
    const listed = EVENT_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(listed).size).toBe(listed.length);
    expect(groupOf('battle')).toBe('battles');
    expect(groupOf('naval')).toBe('battles');
    expect(groupOf('siege')).toBe('captures');
    expect(groupOf('end')).toBe('collapses');
  });

  it('returns everything newest first without filters', () => {
    const r = filterEvents(log, all);
    expect(r.matched).toBe(7);
    expect(r.list.map((e) => e.day)).toEqual([12, 9, 8, 6, 5, 3, 1]);
  });

  it('filters by one or several groups', () => {
    expect(filterEvents(log, { ...all, groups: new Set(['battles'] as const) }).list.map((e) => e.day)).toEqual([8, 3]);
    expect(filterEvents(log, { ...all, groups: new Set(['captures', 'collapses'] as const) }).list.map((e) => e.day)).toEqual([12, 9, 5]);
  });

  it('filters by side and keeps neutral events on either side', () => {
    expect(filterEvents(log, { ...all, side: '1' }).list.map((e) => e.day)).toEqual([8, 6, 5]);
    expect(filterEvents(log, { ...all, side: '0' }).list.map((e) => e.day)).toEqual([12, 9, 6, 3, 1]);
  });

  it('searches text and why, case-insensitively', () => {
    expect(filterEvents(log, { ...all, query: 'MADRID' }).list.map((e) => e.day)).toEqual([9]);
    expect(filterEvents(log, { ...all, query: 'tech gap' }).list.map((e) => e.day)).toEqual([3]);
  });

  it('caps the list but counts every match', () => {
    const r = filterEvents(log, all, 2);
    expect(r.list.map((e) => e.day)).toEqual([12, 9]);
    expect(r.matched).toBe(7);
  });

  it('counts events per group', () => {
    const c = groupCounts(log);
    expect(c.battles).toBe(2);
    expect(c.captures).toBe(2);
    expect(c.collapses).toBe(1);
    expect(c.forces).toBe(1);
    expect(c.weather).toBe(1);
    expect(c.nuclear).toBe(0);
  });
});

describe('live dashboard helpers', () => {
  it('finds the latest sample at or before a day', () => {
    const days = [0, 1, 2, 5, 9];
    expect(indexAtOrBefore(days, -1)).toBe(-1);
    expect(indexAtOrBefore(days, 0)).toBe(0);
    expect(indexAtOrBefore(days, 4)).toBe(2);
    expect(indexAtOrBefore(days, 9)).toBe(4);
    expect(indexAtOrBefore(days, 100)).toBe(4);
    expect(indexAtOrBefore([], 3)).toBe(-1);
  });

  it('measures the change over a trailing window of days', () => {
    const days = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const v = days.map((d) => 100 - d * 2);
    expect(deltaOver(days, v, 7)).toBe(-14);   // day 10 vs day 3
    expect(deltaOver(days, v, 1)).toBe(-2);
  });

  it('measures from the first sample when the run is younger than the window', () => {
    expect(deltaOver([0, 1, 2], [10, 12, 15], 7)).toBe(5);
  });

  it('handles gaps in sampled days and too-short series', () => {
    expect(deltaOver([0, 4, 9], [1, 2, 4], 7)).toBe(3); // 9-7=2, latest at or before is day 0
    expect(deltaOver([0], [1], 7)).toBeNull();
    expect(deltaOver([], [], 7)).toBeNull();
  });

  it('splits two values, centred when both are zero', () => {
    expect(share(3, 1)).toBe(0.75);
    expect(share(0, 0)).toBe(0.5);
    expect(share(0, 5)).toBe(0);
  });
});

describe('result numbers', () => {
  it('counts only enemy-inflicted causes as battle losses', () => {
    // Rome against the Swiss: almost all of its 336k casualties were starvation
    const r = splitLosses({ combat: 150, pursuit: 30, captured: 20, air: 0, naval: 0, nuclear: 0, disease: 1000, starvation: 330_000, exposure: 4000, desertion: 800 });
    expect(r).toEqual({ battle: 200, other: 335_800 });
    expect(splitLosses(undefined)).toEqual({ battle: 0, other: 0 });
  });

  it('measures strength against the peak, which an army entering in stages cannot exceed', () => {
    const swiss = [5010, 40_000, 148_000, 147_800];
    expect(peakOf(swiss)).toBe(148_000);
    expect(swiss.every((v) => v / peakOf(swiss) <= 1)).toBe(true);
    expect(peakOf([])).toBe(0);
  });
});
