import { describe, expect, it } from 'vitest';
import { validateAll, eraOf, isbnValid } from '../data-pipeline/validate';

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
    expect(isbnValid('0-8047-2399-X')).toBe(true);
  });

  it('eras are half-open with historical year numbering', () => {
    expect(eraOf(-480)).toBe('iron');
    expect(eraOf(476)).toBe('medieval');
    expect(eraOf(1500)).toBe('gunpowder');
    expect(eraOf(1914)).toBe('worldwars');
    expect(eraOf(2026)).toBe('modern');
  });
});
