// Which scenario override paths may be written into a snapshot. Overrides come from
// share links and loaded files, so they are untrusted input. A path like
// "__proto__.voronoiControl" used to walk into Object.prototype inside the engine
// worker and flip SimOptions defaults for every later run in the tab (red team C1).
// The rule is a whitelist of the shape the Editor produces, not a blacklist of bad
// keys, so a path outside the editable fields is refused too. The engine and the
// scenario loader both use it, so the check holds even if one of them is bypassed.
import type { UnitRole } from '../types/schema';
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
export const FORCE_COUNT_FACTOR = 10;

/** Why `value` may not be written at `path` (a path overridePathProblem accepted), or null. */
export function overrideValueProblem(path: string, value: unknown): string | null {
  // every estimate in the data is a count, share, level or size, none below 0 (no negative
  // low, mid or high in data/raw/snapshots); a negative count broke personnel conservation (C3)
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a finite number`;
  if (value < 0) return `${path} must be at least 0`;
  const keys = path.split('.');
  if (keys[0] === 'military' && keys[1] === 'forces' && keys[3] === 'count') {
    const max = FORCE_COUNT_FACTOR * MAX_RESEARCHED_FORCE_COUNT[keys[2] as UnitRole];
    if (value > max) return `${path} must be at most ${max.toLocaleString('en-US')} (10x the largest researched ${keys[2]} count)`;
  }
  return null;
}
