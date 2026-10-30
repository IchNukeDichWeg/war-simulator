import { DEFAULT_RULES, DEFAULT_VICTORY, type Scenario } from '../types/scenario';
import type { Override } from '../types/schema';
import { overridePathProblem, overrideValueProblem } from '../engine/overridePath';

export type BBox = [number, number, number, number];

/** Theater presets [west, south, east, north]. Pacific stops at 180 E because the
 *  scenario bbox is not antimeridian-aware; Hawaii/Midway lie outside it. */
export const THEATERS: { name: string; bbox: BBox }[] = [
  { name: 'Europe', bbox: [-12, 34, 45, 62] },
  { name: 'Mediterranean', bbox: [-8, 29, 38, 47] },
  { name: 'Middle East', bbox: [25, 12, 63, 42] },
  { name: 'East Asia', bbox: [95, 15, 150, 52] },
  { name: 'Pacific', bbox: [100, -35, 180, 50] },
  { name: 'North America', bbox: [-130, 15, -55, 60] },
  { name: 'World', bbox: [-180, -60, 180, 75] },
];

export const SIDE_COLORS: [string, string] = ['#e5534b', '#4c8ed9'];

export function defaultScenario(): Scenario {
  return {
    version: 1,
    id: 'custom-' + Math.floor(Math.random() * 1e9).toString(36),
    name: 'Custom scenario',
    description: '',
    sides: [
      { name: 'Side A', color: SIDE_COLORS[0], members: [] },
      { name: 'Side B', color: SIDE_COLORS[1], members: [] },
    ],
    excluded: [],
    techMode: 'native',
    equalizedTech: 8,
    theater: { name: THEATERS[0].name, bbox: [...THEATERS[0].bbox] as BBox },
    startMonth: 5,
    rules: { ...DEFAULT_RULES },
    victory: { ...DEFAULT_VICTORY },
    seed: 1,
    overrides: [],
  };
}

/** Refuse a link or file whose override would write outside the editable fields
 *  (red team C1: "__proto__.x" polluted the engine worker) or a value no field can hold
 *  (C2/C3: negative or absurd counts). The engine refuses both too. */
function checkOverrides(ovs: Override[]): Override[] {
  ovs.forEach((v, i) => {
    const bad = overridePathProblem(v.path);
    if (bad) throw new Error(`overrides[${i}].path: ${bad}`);
    const badValue = overrideValueProblem(v.path, v.value);
    if (badValue) throw new Error(`overrides[${i}].value: ${badValue}`);
  });
  return ovs;
}

/** Longest text a loaded scenario may carry, per field. The presets reach 60 (name),
 *  153 (description) and 17 (side name) characters and snapshot ids 44, so these leave
 *  ample room while a link can no longer put megabytes into a rendered label (red team C5). */
export const MAX_TEXT = { name: 200, description: 2000, sideName: 100, color: 32, id: 100 } as const;

function checkLength(v: unknown, max: number, field: string): void {
  if (typeof v === 'string' && v.length > max) throw new Error(`${field} is ${v.length.toLocaleString('en-US')} characters long; at most ${max} are allowed`);
}

/** Refuse over-long strings before anything renders or copies them. */
function checkStrings(o: Partial<Scenario>): void {
  checkLength(o.id, MAX_TEXT.id, 'id');
  checkLength(o.name, MAX_TEXT.name, 'name');
  checkLength(o.description, MAX_TEXT.description, 'description');
  checkLength(o.theater?.name, MAX_TEXT.sideName, 'theater.name');
  o.sides?.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    checkLength(s.name, MAX_TEXT.sideName, `sides[${i}].name`);
    checkLength(s.color, MAX_TEXT.color, `sides[${i}].color`);
    if (Array.isArray(s.members)) s.members.forEach((m, k) => checkLength(m, MAX_TEXT.id, `sides[${i}].members[${k}]`));
  });
  if (Array.isArray(o.excluded)) o.excluded.forEach((m, k) => checkLength(m, MAX_TEXT.id, `excluded[${k}]`));
  if (Array.isArray(o.overrides)) o.overrides.forEach((v, k) => { checkLength(v?.snapshotId, MAX_TEXT.id, `overrides[${k}].snapshotId`); checkLength(v?.path, MAX_TEXT.id, `overrides[${k}].path`); });
}

/** Fill gaps in an uploaded / decoded scenario with defaults and reject the unusable. */
export function normalizeScenario(x: unknown): Scenario {
  if (!x || typeof x !== 'object') throw new Error('not a scenario object');
  const o = x as Partial<Scenario>;
  if (!Array.isArray(o.sides) || o.sides.length !== 2) throw new Error('scenario needs exactly two sides');
  checkStrings(o);
  const d = defaultScenario();
  const sides = o.sides.map((s, i) => ({
    ...d.sides[i],
    ...s,
    members: Array.isArray(s?.members) ? s.members.filter((m) => typeof m === 'string') : [],
  })) as Scenario['sides'];
  const bbox = o.theater?.bbox;
  const okBox = Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(v));
  return {
    ...d,
    ...o,
    version: 1,
    sides,
    excluded: Array.isArray(o.excluded) ? o.excluded : [],
    theater: okBox ? { name: o.theater?.name ?? 'Custom', bbox: bbox as BBox } : d.theater,
    rules: { ...d.rules, ...(o.rules ?? {}) },
    victory: { ...d.victory, ...(o.victory ?? {}) },
    overrides: Array.isArray(o.overrides) ? checkOverrides(o.overrides.filter((v) => v && typeof v.path === 'string')) : [],
    seed: Number.isFinite(o.seed) ? (o.seed as number) : 1,
  };
}
