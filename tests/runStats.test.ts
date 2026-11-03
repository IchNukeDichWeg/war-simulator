import { describe, expect, it } from 'vitest';
import { deltaOver, indexAtOrBefore, share } from '../src/ui/runStats';

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
