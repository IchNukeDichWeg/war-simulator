import { describe, expect, it } from 'vitest';
import { deltaLabel, describeOverride, estAt, fieldLabel } from '../src/ui/overrideDiff';
import { collectFields } from '../src/ui/panels/Editor';
import { est, makeSnapshot } from './fixtures/snapshots.fixture';

const snap = makeSnapshot({ id: 'alpha-1900', name: 'Alpha', year: 1900, tech: 7, capital: { lat: 0, lon: 0 }, rect: [0, 0, 1, 1], forces: { infantry_line: 1000 } });
snap.military.activePersonnel = est(1000, 800, 1300);

describe('fieldLabel', () => {
  it('names fields the way the Editor groups them', () => {
    expect(fieldLabel('military.forces.infantry_line.count')).toEqual({ group: 'forces', label: 'infantry line count' });
    expect(fieldLabel('economy.production.armor')).toEqual({ group: 'production', label: 'armor' });
    expect(fieldLabel('tech.weapons')).toEqual({ group: 'tech', label: 'weapons' });
    expect(fieldLabel('military.activePersonnel')).toEqual({ group: 'military', label: 'activePersonnel' });
  });
  it('matches collectFields for every field of a snapshot', () => {
    for (const f of collectFields(snap)) expect(fieldLabel(f.path)).toEqual({ group: f.group, label: f.label });
  });
});

describe('estAt', () => {
  it('finds an Est by path and refuses prototype keys and non-Est nodes', () => {
    expect(estAt(snap, 'military.activePersonnel')?.mid).toBe(1000);
    expect(estAt(snap, 'military.forces.infantry_line.count')?.mid).toBe(1000);
    expect(estAt(snap, 'military.forces')).toBeUndefined();
    expect(estAt(snap, 'military.forces.armor.count')).toBeUndefined();
    expect(estAt(snap, '__proto__.constructor')).toBeUndefined();
    expect(estAt(snap, 'military.toString')).toBeUndefined();
  });
});

describe('describeOverride', () => {
  const row = (value: number, path = 'military.activePersonnel.mid') => describeOverride({ snapshotId: snap.id, path, value }, snap);
  it('compares the edit with the researched value', () => {
    const r = row(1250);
    expect(r).toMatchObject({ field: 'military.activePersonnel', group: 'military', label: 'activePersonnel', ratio: 1.25, outOfRange: false });
    expect(r.base?.mid).toBe(1000);
    expect(deltaLabel(r)).toBe('+25%');
    expect(row(1400).outOfRange).toBe(true);
    expect(row(700).outOfRange).toBe(true);
  });
  it('labels the change by size', () => {
    expect(deltaLabel(row(400))).toBe('-60%');
    expect(deltaLabel(row(1005))).toBe('+0.5%');
    expect(deltaLabel(row(10_000))).toBe('x10');
    expect(deltaLabel(row(123_000))).toBe('x120');
    expect(deltaLabel(row(1000))).toBe('no change');
    expect(deltaLabel(row(5, 'logistics.railKm.mid'))).toBe('from 0');
  });
  it('keeps overrides whose snapshot is not loaded', () => {
    const r = describeOverride({ snapshotId: 'gamma-1300', path: 'tech.weapons.mid', value: 4 }, undefined);
    expect(r).toMatchObject({ label: 'weapons', base: undefined, ratio: undefined, outOfRange: false });
    expect(deltaLabel(r)).toBe('');
  });
});
