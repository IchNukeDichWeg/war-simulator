import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, parseColor } from '../src/ui/color';

describe('colour helpers for chart legibility', () => {
  it('parses the formats theme tokens and side colours use', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#d04a3a')).toEqual([208, 74, 58]);
    expect(parseColor('#d04a3acc')).toEqual([208, 74, 58]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('oklch(0.7 0.1 30)')).toBeNull();
    expect(parseColor('')).toBeNull();
  });

  it('computes WCAG contrast (black on white is 21:1)', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([128, 128, 128], [128, 128, 128])).toBeCloseTo(1, 5);
  });

  it('leaves a colour that already passes untouched', () => {
    expect(ensureContrast('#d04a3a', '#161b22')).toBe('#d04a3a');
    expect(ensureContrast('#3a78d0', '#ffffff')).toBe('#3a78d0');
  });

  it('darkens a pale colour on a light panel and lightens a dark one on a dark panel to 3:1', () => {
    const onLight = ensureContrast('#f2d16b', '#ffffff');
    expect(onLight).not.toBe('#f2d16b');
    expect(contrast(parseColor(onLight)!, [255, 255, 255])).toBeGreaterThanOrEqual(3);
    const onDark = ensureContrast('#202020', '#161b22');
    expect(contrast(parseColor(onDark)!, parseColor('#161b22')!)).toBeGreaterThanOrEqual(3);
  });

  it('passes through colours it cannot parse rather than guessing', () => {
    expect(ensureContrast('tomato', '#ffffff')).toBe('tomato');
    expect(ensureContrast('#f2d16b', 'oklch(1 0 0)')).toBe('#f2d16b');
  });
});
