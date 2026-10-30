// Which scenario override paths may be written into a snapshot. Overrides come from
// share links and loaded files, so they are untrusted input. A path like
// "__proto__.voronoiControl" used to walk into Object.prototype inside the engine
// worker and flip SimOptions defaults for every later run in the tab (red team C1).
// The rule is a whitelist of the shape the Editor produces, not a blacklist of bad
// keys, so a path outside the editable fields is refused too. The engine and the
// scenario loader both use it, so the check holds even if one of them is bypassed.
import type { TechCategory, UnitRole } from '../types/schema';
import { ROLES } from './roles';

/** Snapshot sections the Editor lists (collectFields in src/ui/panels/Editor.tsx). */
export const OVERRIDE_ROOTS = ['territory', 'demography', 'military', 'tech', 'economy', 'logistics', 'strategic', 'geography'] as const;
const ROOTS = new Set<string>(OVERRIDE_ROOTS);
/** Names that reach a prototype through plain property access. The segment pattern
 *  already excludes "__proto__"; the other two are ordinary identifiers. */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ROLE_SET = new Set<string>(ROLES);
const SEGMENT = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Every Est in the shipped snapshots sits 2 to 4 keys deep, so with ".mid" a path has
 *  3 to 5 segments (11,220 / 479 / 8,085 fields in public/data/snapshots.json). */
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 5;

/** Why `path` may not be used as an override path, or null if it may. */
export function overridePathProblem(path: unknown): string | null {
  if (typeof path !== 'string') return 'path is not a string';
  const keys = path.split('.');
  if (keys.length < MIN_SEGMENTS || keys.length > MAX_SEGMENTS) return `"${path.slice(0, 80)}" is not an editable field`;
  if (!ROOTS.has(keys[0])) return `"${path.slice(0, 80)}" is not an editable field (must start with ${OVERRIDE_ROOTS.join(', ')})`;
  for (const k of keys) {
    if (FORBIDDEN.has(k) || !SEGMENT.test(k)) return `"${path.slice(0, 80)}" is not an editable field`;
  }
  // force counts exist per role; an unknown role would only add an entry the engine never reads
  if (keys[0] === 'military' && keys[1] === 'forces' && !ROLE_SET.has(keys[2])) return `"${path.slice(0, 80)}" is not an editable field (unknown role ${keys[2]})`;
  // the Editor only edits the mid of an estimate; low/high and whole subtrees stay researched
  if (keys[keys.length - 1] !== 'mid') return `"${path.slice(0, 80)}" is not an editable field (must end in .mid)`;
  // every field the Editor offers has a bound below; "tech.newcategory.mid" used to pass
  // and write a field the engine never reads
  if (!fieldBound(keys.slice(0, -1).join('.'))) return `"${path.slice(0, 80)}" is not an editable field`;
  return null;
}

/** Largest researched force count per role in data/raw/snapshots (max of low, mid and high
 *  over all 1,234 files at be0365c), with the snapshot it came from. The override bound is
 *  10x this: room for "what if they had ten times the army" while a typo such as 1e15 is
 *  refused before the engine sees it (red team C2: 1e15 infantry aborted V8).
 *  tests/inputBoundary.test.ts fails if a snapshot ever exceeds a value here. */
export const MAX_RESEARCHED_FORCE_COUNT: Record<UnitRole, number> = {
  infantry_line: 6_829_651,   // british-raj-1914 (high)
  missile_infantry: 650_000,  // song-1100
  infantry_light: 600_000,    // qing-1894
  cavalry_light: 459_737,     // british-raj-1878
  cavalry_heavy: 250_000,     // mughal-empire-1690
  artillery: 90_000,          // ussr-1944
  ifv_apc: 78_000,            // ussr-1989
  armor: 55_000,              // ussr-1989
  aircraft_fighter: 13_000,   // ussr-1941
  helicopters: 12_500,        // usa-1989
  elephants: 12_000,          // mughal-empire-1690
  aircraft_strike: 10_000,    // ussr-1941
  chariots: 8_000,            // maurya--250
  drones: 8_000,              // russia-2026
  ships_minor: 6_000,         // mongol-empire-1279
  air_defense: 5_200,         // ussr-1989
  ships_major: 3_755,         // scythians--200
  missiles: 3_200,            // ussr-1989
  submarines: 826,            // british-raj-1914
};

/** Largest researched yearly production per role, same rule and data (5d05563). Only
 *  platform roles have researched production; a personnel role has none, so the Editor
 *  never offers it and a link that writes one is refused as not an editable field. */
export const MAX_RESEARCHED_PRODUCTION: Partial<Record<UnitRole, number>> = {
  artillery: 148_000,         // germany-1944
  armor: 38_500,              // usa-1941
  aircraft_fighter: 38_000,   // usa-1941
  aircraft_strike: 36_000,    // usa-1941
  drones: 20_000,             // china-2026
  ifv_apc: 5_250,             // ussr-1989
  air_defense: 1_500,         // germany-1944
  helicopters: 1_000,         // usa-1989
  ships_major: 457,           // usa-1941
  missiles: 300,              // china-2026
  ships_minor: 250,           // usa-1863
  submarines: 230,            // germany-1944
};

/** Largest researched value of every other personnel, stock and size field, same rule and
 *  data (5d05563). Before these bounds only force counts were capped, so 1e15 trained
 *  reserves ran to 861 trillion personnel (red team N1). homeDefense is a multiplier with
 *  no defined top, so it takes the 10x rule too. */
export const MAX_RESEARCHED_VALUE: Record<string, number> = {
  'territory.areaKm2': 22_800_000,              // russian-empire-1904
  'demography.population': 1_478_504_180,       // india-2026
  'military.activePersonnel': 17_773_414,       // british-raj-1914
  'military.trainedReserves': 10_000_000,       // china-1979
  'military.supportPersonnel': 12_442_681,      // british-raj-1914
  'military.mobilizable': 118_260_000,          // china-1979
  'economy.gdpPerCapita': 133_343,              // singapore-2026
  'economy.gdp': 33_679_754_342_015,            // china-2026
  'economy.annualCohort': 14_601_367,           // india-2026
  'logistics.roadKm': 6_700_000,                // india-2026
  'logistics.railKm': 732_233,                  // canada-hb-1914
  'logistics.majorPorts': 885,                  // scythians--200
  'logistics.merchantTonnage': 400_000_000,     // greece-2026
  'logistics.supplyRangeKm': 6_000,             // usa-1989
  'logistics.draftAnimals': 80_000_000,         // india-1971
  'strategic.nuclearWarheads': 37_000,          // ussr-1989
  'geography.homeDefense': 1.4,                 // finland-1939
};
export const FORCE_COUNT_FACTOR = 10;

/** Fields on a defined scale, bounded by its top instead of by the data: shares and ratings
 *  are 0..1 and tech levels 0..10 (src/types/schema.ts). Above the top they mean nothing,
 *  and 1e300 tech or quality ran without a check (red team N1). */
// the list in setup.ts (TECH_CATS); not imported because setup.ts imports this module
const TECH_CATEGORIES: TechCategory[] = ['weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber'];
export const SCALE_TOP: Record<string, number> = {
  'demography.urbanization': 1,
  'military.mobilizationRatio': 1,
  'military.commandQuality': 1,
  'military.cohesion': 1,
  'military.morale': 1,
  'economy.milSpendShare': 1,
  'economy.industrialShare': 1,
  'economy.foodSurplus': 1,
  ...Object.fromEntries(TECH_CATEGORIES.map((c) => [`tech.${c}`, 10])),
};

/** The bound of an editable field (its path without ".mid"): the largest researched value
 *  (the override may be 10x that) or the top of its scale. Undefined for a path no snapshot
 *  holds, which is then not editable. */
export function fieldBound(field: string): { researched: number } | { scaleTop: number } | undefined {
  const keys = field.split('.');
  if (keys.length === 4 && keys[0] === 'military' && keys[1] === 'forces' && ROLE_SET.has(keys[2])) {
    if (keys[3] === 'count') return { researched: MAX_RESEARCHED_FORCE_COUNT[keys[2] as UnitRole] };
    if (keys[3] === 'quality' || keys[3] === 'training') return { scaleTop: 1 };
    return undefined;
  }
  if (keys.length === 3 && keys[0] === 'economy' && keys[1] === 'production') {
    const v = Object.hasOwn(MAX_RESEARCHED_PRODUCTION, keys[2]) ? MAX_RESEARCHED_PRODUCTION[keys[2] as UnitRole] : undefined;
    return v === undefined ? undefined : { researched: v };
  }
  // own keys only, so "toString" and the like never look like a field (red team C1)
  if (Object.hasOwn(MAX_RESEARCHED_VALUE, field)) return { researched: MAX_RESEARCHED_VALUE[field] };
  if (Object.hasOwn(SCALE_TOP, field)) return { scaleTop: SCALE_TOP[field] };
  return undefined;
}

/** Largest value an override may write at `path` (ending in ".mid"), or undefined. */
export function overrideMax(path: string): number | undefined {
  const b = fieldBound(path.slice(0, path.lastIndexOf('.')));
  if (!b) return undefined;
  return 'researched' in b ? FORCE_COUNT_FACTOR * b.researched : b.scaleTop;
}

/** Why `value` may not be written at `path` (a path overridePathProblem accepted), or null. */
export function overrideValueProblem(path: string, value: unknown): string | null {
  // every estimate in the data is a count, share, level or size, none below 0 (no negative
  // low, mid or high in data/raw/snapshots); a negative count broke personnel conservation (C3)
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a finite number`;
  if (value < 0) return `${path} must be at least 0`;
  const field = path.slice(0, path.lastIndexOf('.'));
  const b = fieldBound(field);
  if (!b) return `${path} is not an editable field`;
  if ('scaleTop' in b) {
    if (value > b.scaleTop) return `${path} must be at most ${b.scaleTop} (the top of its scale)`;
  } else {
    const max = FORCE_COUNT_FACTOR * b.researched;
    if (value > max) return `${path} must be at most ${max.toLocaleString('en-US')} (10x the largest researched ${field.split('.').slice(1).join(' ')})`;
  }
  return null;
}
