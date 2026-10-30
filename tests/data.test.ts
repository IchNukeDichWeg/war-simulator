import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAll, eraOf, isbnValid, checkSnapshot, documentedDerivations } from '../data-pipeline/validate';
import type { Snapshot } from '../src/types/schema';

describe('data validation', () => {
  it('all research output under data/ passes schema and cross-field checks', () => {
    const { issues } = validateAll();
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors.map((e) => `${e.file}: ${e.msg}`)).toEqual([]);
  });

  it('ISBN check digits are verified', () => {
    expect(isbnValid('0-674-80930-0')).toBe(true);   // Brewer, The Sinews of Power
    expect(isbnValid('0-674-80930-6')).toBe(false);  // the same with a wrong check digit
    expect(isbnValid('978-0-674-80930-7')).toBe(true);
    expect(isbnValid('0-8044-2957-X')).toBe(true);   // X check digit
  });

  it('a capital or place at exactly 0,0 is rejected (red team W8: Palestine in the Gulf of Guinea)', () => {
    const file = join(new URL('..', import.meta.url).pathname, 'data', 'raw', 'snapshots', 'palestine-2026.json');
    const s: Snapshot = JSON.parse(readFileSync(file, 'utf8'));
    const errs = (x: Snapshot) => { const issues: { level: string; msg: string }[] = []; checkSnapshot(x, file, documentedDerivations(), issues as never); return issues.filter((i) => i.level === 'error' && i.msg.includes('0,0')); };
    expect(errs(s)).toEqual([]);
    expect(s.capital.name).toBe('Ramallah');
    expect(errs({ ...s, capital: { ...s.capital, lat: 0, lon: 0 } })).toHaveLength(1);
    expect(errs({ ...s, places: [...s.places, { name: 'Nowhere', lat: 0, lon: 0, kind: 'city' }] })).toHaveLength(1);
  });

  it('eras are half-open with historical year numbering', () => {
    expect(eraOf(-480)).toBe('iron');
    expect(eraOf(476)).toBe('medieval');
    expect(eraOf(1500)).toBe('gunpowder');
    expect(eraOf(1914)).toBe('worldwars');
    expect(eraOf(2026)).toBe('modern');
  });
});
