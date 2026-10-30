import { describe, expect, it } from 'vitest';
import { dayOfYear, daylightHours } from '../../src/engine/daylight';

// Reference day lengths (sunrise to sunset, NOAA solar calculator convention): Berlin 52.5 N has
// about 7 h 40 min at the December solstice and 16 h 50 min at the June solstice; the equator
// about 12 h 7 min all year; the Arctic circle has polar night at the December solstice.
describe('daylight from latitude', () => {
  it('matches the reference day lengths', () => {
    expect(daylightHours(52.5, 355)).toBeGreaterThan(7.55);
    expect(daylightHours(52.5, 355)).toBeLessThan(7.8);
    expect(daylightHours(52.5, 172)).toBeGreaterThan(16.7);
    expect(daylightHours(52.5, 172)).toBeLessThan(16.95);
    for (const d of [1, 80, 172, 266, 355]) expect(Math.abs(daylightHours(0, d) - 12.12)).toBeLessThan(0.05);
    expect(daylightHours(70, 355)).toBe(0);
    expect(daylightHours(70, 172)).toBe(24);
  });
  it('mirrors the seasons south of the equator', () => {
    expect(Math.abs(daylightHours(-52.5, 355) - daylightHours(52.5, 172))).toBeLessThan(0.15);
  });
  it('counts sim days from the 1st of the start month', () => {
    expect(dayOfYear(1, 1)).toBe(1);
    expect(dayOfYear(2, 15)).toBe(46);
    expect(dayOfYear(12, 31)).toBe(365);
    expect(dayOfYear(12, 32)).toBe(1);
  });
});
