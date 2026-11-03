import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/engine/protocol';
import { deltaOver, EVENT_GROUPS, filterEvents, groupCounts, groupOf, indexAtOrBefore, share } from '../src/ui/runStats';

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
