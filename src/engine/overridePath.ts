// Which scenario override paths may be written into a snapshot. Overrides come from
// share links and loaded files, so they are untrusted input. A path like
// "__proto__.voronoiControl" used to walk into Object.prototype inside the engine
// worker and flip SimOptions defaults for every later run in the tab (red team C1).
// The rule is a whitelist of the shape the Editor produces, not a blacklist of bad
// keys, so a path outside the editable fields is refused too. The engine and the
// scenario loader both use it, so the check holds even if one of them is bypassed.

/** Snapshot sections the Editor lists (collectFields in src/ui/panels/Editor.tsx). */
export const OVERRIDE_ROOTS = ['territory', 'demography', 'military', 'tech', 'economy', 'logistics', 'strategic', 'geography'] as const;
const ROOTS = new Set<string>(OVERRIDE_ROOTS);
/** Names that reach a prototype through plain property access. The segment pattern
 *  already excludes "__proto__"; the other two are ordinary identifiers. */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
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
  // the Editor only edits the mid of an estimate; low/high and whole subtrees stay researched
  if (keys[keys.length - 1] !== 'mid') return `"${path.slice(0, 80)}" is not an editable field (must end in .mid)`;
  return null;
}
