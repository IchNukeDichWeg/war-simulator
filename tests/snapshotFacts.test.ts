import { describe, expect, it } from 'vitest';
import { forceMix, keyNumbers, snapshotSources, sourceRef, spread } from '../src/ui/snapshotFacts';
import type { Snapshot } from '../src/types/schema';
import { est, makeSnapshot } from './fixtures/snapshots.fixture';

const base = makeSnapshot({ id: 'alpha-1900', name: 'Alpha', year: 1900, tech: 7, capital: { lat: 0, lon: 0 }, rect: [0, 0, 1, 1], forces: { infantry_line: 9000, cavalry_light: 1000, artillery: 40 } });

describe('sourceRef', () => {
  it('links URLs, DOIs and ISBNs and labels derivation methods', () => {
    expect(sourceRef('https://en.wikipedia.org/wiki/Battle_of_Hastings')).toMatchObject({ kind: 'url', href: 'https://en.wikipedia.org/wiki/Battle_of_Hastings', label: 'en.wikipedia.org: Battle of Hastings' });
    expect(sourceRef('doi:10.1038/sdata.2018.214')).toMatchObject({ kind: 'doi', href: 'https://doi.org/10.1038/sdata.2018.214' });
    expect(sourceRef('isbn:978-0-521-84497-3')).toMatchObject({ kind: 'isbn', href: 'https://openlibrary.org/isbn/9780521844973' });
    expect(sourceRef('derived:gdp-from-pc')).toEqual({ source: 'derived:gdp-from-pc', kind: 'derived', label: 'gdp from pc' });
    expect(sourceRef('')).toMatchObject({ kind: 'other', label: 'no source' });
    expect(sourceRef('javascript:alert(1)').href).toBeUndefined();
  });
});

describe('snapshotSources', () => {
  it('counts each source once with the fields citing it, works before methods', () => {
    const url = 'https://example.org/census';
    const s: Snapshot = {
      ...base,
      demography: { population: { ...est(1e6), source: url }, urbanization: { ...est(0.1), source: url } },
      territory: { ...base.territory, areaKm2: { ...est(5), source: 'doi:10.1/x' } },
    };
    const r = snapshotSources(s);
    expect(r[0]).toMatchObject({ source: url, count: 2, fields: ['demography.population', 'demography.urbanization'] });
    expect(r[1]).toMatchObject({ source: 'doi:10.1/x', count: 1, fields: ['territory.areaKm2'] });
    expect(r.slice(2).every((x) => x.kind === 'derived')).toBe(true);
    expect(r.reduce((a, x) => a + x.count, 0)).toBeGreaterThan(30);
  });
});

describe('keyNumbers and forceMix', () => {
  it('lists the key numbers, dropping zero reserves and warheads', () => {
    const labels = keyNumbers(base).map((k) => k.label);
    expect(labels).toContain('Population');
    expect(labels).toContain('Active personnel');
    expect(labels).not.toContain('Trained reserves');
    expect(labels).not.toContain('Nuclear warheads');
    const withNukes: Snapshot = { ...base, strategic: { ...base.strategic, nuclearWarheads: est(10, 5, 20) } };
    expect(keyNumbers(withNukes).map((k) => k.label)).toContain('Nuclear warheads');
  });
  it('lists non-zero forces in role order', () => {
    expect(forceMix(base).map((f) => [f.role, f.count.mid])).toEqual([['infantry_line', 9000], ['cavalry_light', 1000], ['artillery', 40]]);
  });
  it('measures the relative width of a range', () => {
    expect(spread(est(100, 50, 150))).toBe(1);
    expect(spread(est(0))).toBeNull();
  });
});
