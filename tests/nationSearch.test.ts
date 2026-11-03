import { describe, expect, it } from 'vitest';
import {
  buildItems, editDistance, kindCounts, kindOf, parseQuery, searchSnapshots, snapshotConfidence, wordScore,
  type SearchItem,
} from '../src/ui/nationSearch';
import type { Snapshot } from '../src/types/schema';
import { est, makeSnapshot } from './fixtures/snapshots.fixture';

const item = (p: Partial<SearchItem> & Pick<SearchItem, 'id' | 'name' | 'year'>): SearchItem => ({
  nationId: p.id.replace(/-?-\d+$/, ''), era: 'modern', region: 'europe', tags: [], aliases: [], kind: 'researched',
  confidence: 'B', population: 1e6, active: 1e4, loaded: true, ...p,
});

const ITEMS: SearchItem[] = [
  item({ id: 'rome--27', name: 'Roman Empire', year: -27, era: 'iron', region: 'europe', tags: ['empire', 'Mediterranean'], aliases: ['Rome'] }),
  item({ id: 'rome-117', name: 'Roman Empire', year: 117, era: 'iron', region: 'europe', tags: ['empire'], aliases: ['Rome'] }),
  item({ id: 'persia-achaemenid--480', name: 'Achaemenid Persia', year: -480, era: 'iron', region: 'mena', tags: ['empire'] }),
  item({ id: 'france-1805', name: 'French Empire', year: 1805, era: 'industrial', tags: ['empire', 'conscription'], aliases: ['France'] }),
  item({ id: 'france-1940', name: 'France', year: 1940, era: 'worldwars', tags: ['Allies'] }),
  item({ id: 'france-2026', name: 'France', year: 2026, era: 'modern', tags: ['NATO', 'EU'], kind: 'auto' }),
  item({ id: 'germany-1939', name: 'Germany', year: 1939, era: 'worldwars', tags: ['Axis'], aliases: ['German Reich'] }),
  item({ id: 'hre-1500', name: 'Holy Roman Empire', year: 1500, era: 'gunpowder', tags: ['phase3', 'derived', 'state'], kind: 'derived', confidence: 'D', loaded: false }),
  item({ id: 'mongols-1241', name: 'Mongol Empire', year: 1241, era: 'medieval', region: 'central_asia', tags: ['nomadic', 'empire'] }),
  item({ id: 'ottoman-1683', name: 'Ottoman Empire', year: 1683, era: 'gunpowder', region: 'mena', tags: ['empire'] }),
  item({ id: 'kanem-1400', name: 'Kanem-Bornu', year: 1400, era: 'medieval', region: 'subsaharan_africa', tags: ['phase3', 'derived'], kind: 'derived', confidence: 'D' }),
  item({ id: 'sao-tome-2026', name: 'São Tomé and Príncipe', year: 2026, era: 'modern', region: 'subsaharan_africa', kind: 'auto' }),
];
const ids = (q: string, f = {}) => searchSnapshots(ITEMS, q, f).map((r) => r.item.id);

describe('parseQuery', () => {
  it('reads BCE in every written form', () => {
    expect(parseQuery('persia 480 bce').years).toEqual([-480]);
    expect(parseQuery('persia 480bce').years).toEqual([-480]);
    expect(parseQuery('persia -480').years).toEqual([-480]);
    expect(parseQuery('persia 480 bc').text).toEqual(['persia']);
    expect(parseQuery('1066 ad').years).toEqual([1066]);
  });
  it('reads ranges, with a trailing suffix covering both ends', () => {
    expect(parseQuery('1900-1950').ranges).toEqual([[1900, 1950]]);
    expect(parseQuery('1900..1950').ranges).toEqual([[1900, 1950]]);
    expect(parseQuery('500-100 bce').ranges).toEqual([[-500, -100]]);
    expect(parseQuery('100bce-200').ranges).toEqual([[-100, 200]]);
  });
  it('keeps a lone digit as a word and drops filler words', () => {
    expect(parseQuery('world war 2')).toEqual({ text: ['world', 'war', '2'], years: [], ranges: [] });
    expect(parseQuery('kingdom of france').text).toEqual(['kingdom', 'france']);
    expect(parseQuery('of').text).toEqual(['of']);
  });
  it('folds accents and punctuation', () => {
    expect(parseQuery('São-Tomé').text).toEqual(['sao', 'tome']);
  });
});

describe('fuzzy matching', () => {
  it('edit distance counts an adjacent swap as one edit', () => {
    expect(editDistance('otoman', 'ottoman')).toBe(1);
    expect(editDistance('mognol', 'mongol')).toBe(1);
    expect(editDistance('abc', 'xyzabc', 2)).toBe(3);
  });
  it('ranks exact over prefix over substring over typo', () => {
    const s = (t: string, w: string) => wordScore(t, w);
    expect(s('rome', 'rome')).toBeGreaterThan(s('rom', 'roman'));
    expect(s('rom', 'roman')).toBeGreaterThan(s('oma', 'roman'));
    expect(s('oma', 'roman')).toBeGreaterThan(s('romna', 'roman'));
    expect(s('romna', 'roman')).toBeGreaterThan(0);
    expect(s('us', 'uk')).toBe(0);
  });
});

describe('searchSnapshots', () => {
  it('lists everything by name and year for an empty query', () => {
    const r = searchSnapshots(ITEMS, '   ');
    expect(r).toHaveLength(ITEMS.length);
    expect(r[0].item.id).toBe('persia-achaemenid--480');
  });
  it('requires every word to match (AND)', () => {
    expect(ids('roman empire')).toEqual(['rome--27', 'rome-117', 'hre-1500']);
    expect(ids('roman nomadic')).toEqual([]);
  });
  it('finds a nation by alias, tag, region and era words', () => {
    expect(ids('german reich')).toEqual(['germany-1939']);
    expect(ids('nomadic')).toEqual(['mongols-1241']);
    expect(ids('central asia')).toEqual(['mongols-1241']);
    expect(ids('nato')).toEqual(['france-2026']);
    expect(ids('bronze')).toEqual([]);
    expect(ids('gunpowder empire')).toEqual(['ottoman-1683', 'hre-1500']);
  });
  it('tolerates typos and matches initials', () => {
    expect(ids('otoman')[0]).toBe('ottoman-1683');
    expect(ids('mognol')[0]).toBe('mongols-1241');
    expect(ids('hre')[0]).toBe('hre-1500');
    expect(ids('sao tome')).toEqual(['sao-tome-2026']);
    expect(ids('kanem bornu')).toEqual(['kanem-1400']);
  });
  it('puts the name match above tag-only matches', () => {
    // "france" is the name of two snapshots and an alias of a third
    expect(ids('france').slice(0, 2).sort()).toEqual(['france-1940', 'france-2026']);
    expect(ids('france')[2]).toBe('france-1805');
  });
  it('ranks by closeness to a year given with words', () => {
    expect(ids('france 1939')).toEqual(['france-1940', 'france-2026', 'france-1805']);
    expect(ids('rome 30 bce')[0]).toBe('rome--27');
    expect(ids('rome 100')[0]).toBe('rome-117');
  });
  it('filters by a year alone, nearest first', () => {
    expect(ids('1940')).toEqual(['france-1940', 'germany-1939']);
    expect(ids('480 bce')).toEqual(['persia-achaemenid--480']);
  });
  it('filters by a year range', () => {
    expect(ids('1900-1950')).toEqual(['france-1940', 'germany-1939']);
    expect(ids('empire 100bce-200')).toEqual(['rome--27', 'rome-117']);
  });
  it('applies era, region, kind and minimum grade filters', () => {
    expect(ids('', { era: 'iron', region: 'mena' })).toEqual(['persia-achaemenid--480']);
    expect(ids('france', { kind: 'auto' })).toEqual(['france-2026']);
    expect(ids('empire', { kind: 'derived' })).toEqual(['hre-1500']);
    expect(ids('empire', { minGrade: 'C' })).not.toContain('hre-1500');
    expect(ids('', { minGrade: 'A' })).toEqual([]);
  });
  it('breaks score ties researched first, then by grade', () => {
    const tie = [
      item({ id: 'x-1', name: 'Xia', year: 1, kind: 'derived', confidence: 'D' }),
      item({ id: 'x-2', name: 'Xia', year: 1, kind: 'auto', confidence: 'B' }),
      item({ id: 'x-3', name: 'Xia', year: 1, kind: 'researched', confidence: 'C' }),
      item({ id: 'x-4', name: 'Xia', year: 1, kind: 'researched', confidence: 'A' }),
    ];
    expect(searchSnapshots(tie, 'xia').map((r) => r.item.id)).toEqual(['x-4', 'x-3', 'x-2', 'x-1']);
  });
  it('finds descriptively named researched snapshots through the nation id and other names', () => {
    // shapes taken from the shipped data: researched names are descriptive, Phase 3 names short
    const set = [
      item({ id: 'algeria-france-1938', name: 'Algeria (France)', year: 1938, kind: 'derived', confidence: 'D', tags: ['subject of France'] }),
      item({ id: 'france-1939', name: 'French Republic', year: 1939, aliases: ['French Third Republic'] }),
      item({ id: 'rome-hb--200', name: 'Rome', year: -200, kind: 'derived', confidence: 'D' }),
      item({ id: 'rome-117', name: 'Roman Empire (Trajan)', year: 117 }),
      item({ id: 'ukraine-2026', name: 'Ukraine', year: 2026 }),
      item({ id: 'united-kingdom-2026', name: 'United Kingdom', year: 2026 }),
      item({ id: 'persia-400', name: 'Persia', year: 400, kind: 'derived', confidence: 'D' }),
      item({ id: 'persia-achaemenid--480', name: 'Achaemenid Empire (Xerxes I)', year: -480 }),
    ];
    const top = (q: string) => searchSnapshots(set, q)[0].item.id;
    expect(top('france')).toBe('france-1939');
    expect(top('rome')).toBe('rome-117');
    expect(top('uk')).toBe('united-kingdom-2026');
    expect(top('persia 480 bce')).toBe('persia-achaemenid--480');
    expect(top('persia')).toBe('persia-400');
  });
  it('counts matches per kind ignoring the kind filter', () => {
    expect(kindCounts(ITEMS, 'empire', { kind: 'researched' })).toEqual({ researched: 6, auto: 0, derived: 1 });
  });
});

describe('items from app data', () => {
  const a = makeSnapshot({ id: 'alpha-1900', name: 'Alpha', year: 1900, tech: 7, capital: { lat: 0, lon: 0 }, rect: [0, 0, 1, 1], forces: { infantry_line: 1000 } });
  const b: Snapshot = { ...makeSnapshot({ id: 'beta-2026', name: 'Beta', year: 2026, tech: 10, capital: { lat: 0, lon: 0 }, rect: [0, 0, 1, 1], forces: {} }), tags: ['auto-base'] };
  it('grades a snapshot by the mean of its values like the pipeline', () => {
    const s: Snapshot = { ...a, demography: { population: { ...est(1), grade: 'A' }, urbanization: { ...est(1), grade: 'A' } } };
    const c = snapshotConfidence(s);
    expect(c.counts.A).toBe(2);
    expect(c.n).toBeGreaterThan(30);
    expect(c.letter).toBe('D');
    expect(snapshotConfidence(s)).toBe(c); // cached per object
  });
  it('merges loaded snapshots with unloaded Phase 3 index entries', () => {
    const p3 = { id: 'gamma-1300', nationId: 'gamma', name: 'Gamma', year: 1300, era: 'medieval' as const, region: 'europe' as const, tags: ['phase3'], confidence: 'D' as const, population: 5, active: 1 };
    const d = {
      snapshots: [b, a], phase3: [p3], phase3ById: new Map([[p3.id, p3]]),
      snapById: new Map([[a.id, a], [b.id, b]]), nationById: new Map([['alpha', { id: 'alpha', name: 'Alpha', aliases: ['Alfa'], region: 'europe' as const, snapshotIds: [a.id] }]]),
    };
    const items = buildItems(d);
    expect(items.map((x) => [x.id, x.kind, x.loaded])).toEqual([['alpha-1900', 'researched', true], ['beta-2026', 'auto', true], ['gamma-1300', 'derived', false]]);
    expect(items[0].aliases).toEqual(['Alfa']);
    expect(items[0].activeGrade).toBe('D');
    expect(buildItems(d)).toBe(items);
    expect(kindOf({ id: 'z', tags: [] }, true)).toBe('derived');
  });
});
