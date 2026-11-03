// Research prose split out of public/data/snapshots.json into snapshot-notes.json.
// Every string-valued `note`, `source` and `notes` key is prose for people (the Editor, tooltips);
// the engine never reads them. They were 4.46 MB of the 6.51 MB snapshots.json (shipped data,
// 330 snapshots), so the build moves them to their own file, the first screen loads the rest,
// and the notes are merged back before the engine gets the snapshots. splitSnapshotText and
// mergeSnapshotText are inverse up to key order (tests/snapshotText.test.ts).

const TEXT_KEYS = new Set(['note', 'source', 'notes']);

/** The stripped strings of one value, in the same shape: objects keep only the keys that lead to
 *  a string, arrays keep their length with null for elements without one. */
export type TextTree = { [k: string]: string | TextTree | (TextTree | null)[] };

function strip(v: unknown): [unknown, TextTree | (TextTree | null)[] | null] {
  if (Array.isArray(v)) {
    const parts = v.map(strip);
    const text = parts.map((p) => p[1] as TextTree | null);
    return [parts.map((p) => p[0]), text.some((t) => t) ? text : null];
  }
  if (!v || typeof v !== 'object') return [v, null];
  const core: Record<string, unknown> = {};
  const text: TextTree = {};
  let any = false;
  for (const [k, x] of Object.entries(v)) {
    if (TEXT_KEYS.has(k) && typeof x === 'string') { text[k] = x; any = true; continue; }
    const [c, t] = strip(x);
    core[k] = c;
    if (t) { text[k] = t; any = true; }
  }
  return [core, any ? text : null];
}

/** Split snapshots into the engine-facing part and the prose, keyed by snapshot id. */
export function splitSnapshotText<T extends { id: string }>(snaps: T[]): { core: T[]; text: Record<string, TextTree> } {
  const core: T[] = [];
  const text: Record<string, TextTree> = {};
  for (const s of snaps) {
    const [c, t] = strip(s);
    core.push(c as T);
    if (t) text[s.id] = t as TextTree;
  }
  return { core, text };
}

function merge(target: unknown, t: TextTree | (TextTree | null)[]): void {
  if (!target || typeof target !== 'object') return;
  if (Array.isArray(t)) {
    if (Array.isArray(target)) t.forEach((x, i) => { if (x) merge(target[i], x); });
    return;
  }
  const o = target as Record<string, unknown>;
  for (const [k, x] of Object.entries(t)) {
    if (typeof x === 'string') o[k] = x;
    else merge(o[k], x);
  }
}

/** Put the prose back into the snapshots, in place. Ids without an entry are left alone. */
export function mergeSnapshotText<T extends { id: string }>(snaps: T[], text: Record<string, TextTree>): T[] {
  for (const s of snaps) { const t = text[s.id]; if (t) merge(s, t); }
  return snaps;
}
