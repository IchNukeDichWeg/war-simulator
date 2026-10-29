import { DEFAULT_RULES, DEFAULT_VICTORY, type Scenario } from '../types/scenario';

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

/** Fill gaps in an uploaded / decoded scenario with defaults and reject the unusable. */
export function normalizeScenario(x: unknown): Scenario {
  if (!x || typeof x !== 'object') throw new Error('not a scenario object');
  const o = x as Partial<Scenario>;
  if (!Array.isArray(o.sides) || o.sides.length !== 2) throw new Error('scenario needs exactly two sides');
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
    overrides: Array.isArray(o.overrides) ? o.overrides.filter((v) => v && typeof v.path === 'string' && Number.isFinite(v.value)) : [],
    seed: Number.isFinite(o.seed) ? (o.seed as number) : 1,
  };
}
