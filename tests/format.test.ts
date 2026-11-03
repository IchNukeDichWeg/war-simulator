import { describe, expect, it } from 'vitest';
import { capitalize, fmt, fmtDays, fmtSpeed, pct, signed, signedPts } from '../src/ui/format';

describe('run panel formatting', () => {
  it('keeps the existing number format', () => {
    expect(fmt(123456)).toBe('123k');
    expect(fmt(2_500_000)).toBe('2.5M');
    expect(fmt(0)).toBe('0');
    expect(fmt(NaN)).toBe('-');
    expect(pct(0.456)).toBe('46%');
  });

  it('formats durations in days with a rough calendar equivalent', () => {
    expect(fmtDays(1)).toBe('1 day');
    expect(fmtDays(34)).toBe('34 days');
    expect(fmtDays(120)).toBe('120 days (about 4 months)');
    expect(fmtDays(800)).toBe('800 days (about 2.2 years)');
    expect(fmtDays(12.6)).toBe('13 days');
    expect(fmtDays(undefined)).toBe('-');
  });

  it('signs changes explicitly', () => {
    expect(signed(1234)).toBe('+1,234');
    expect(signed(-45000)).toBe('-45k');
    expect(signed(0)).toBe('0');
    expect(signedPts(0.031)).toBe('+3 pts');
    expect(signedPts(-0.12)).toBe('-12 pts');
    expect(signedPts(0.001)).toBe('0 pts');
    expect(signedPts(null)).toBe('-');
  });

  it('labels playback speed', () => {
    expect(fmtSpeed(0)).toBe('paused');
    expect(fmtSpeed(1 / 86400)).toBe('real time');
    expect(fmtSpeed(1)).toBe('1 day/s');
    expect(fmtSpeed(30)).toBe('30 days/s');
    expect(fmtSpeed(0.5)).toBe('0.50 days/s');
  });

  it('capitalizes engine strings for headlines', () => {
    expect(capitalize('time limit')).toBe('Time limit');
    expect(capitalize('')).toBe('');
  });
});
