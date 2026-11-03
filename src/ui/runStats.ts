// Pure helpers behind the run panel (live dashboard, event log, result, Monte Carlo). No DOM,
// no store: unit-tested in tests/runStats.test.ts. Nothing here feeds back into the engine.
import type { SimEvent } from '../engine/protocol';

/** Index of the latest sample at or before `day` (days ascending); -1 when none. */
export function indexAtOrBefore(days: readonly number[], day: number): number {
  let lo = 0, hi = days.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Change of a series over the last `window` days: latest value minus the value at the latest
 * sample at or before (latest day - window). Null with fewer than two samples. When the run is
 * younger than the window, the change is measured from the first sample.
 */
export function deltaOver(days: readonly number[], values: readonly number[], window: number): number | null {
  const n = Math.min(days.length, values.length);
  if (n < 2) return null;
  const j = Math.max(0, indexAtOrBefore(days.slice(0, n), days[n - 1] - window));
  if (j === n - 1) return null;
  return values[n - 1] - values[j];
}

// ------------------------------------------------------------------ event log

export type EventGroup = 'battles' | 'captures' | 'collapses' | 'forces' | 'supply' | 'nuclear' | 'weather';

/** Filter groups over the engine's event kinds, in display order. Capital losses are 'capture'
 *  events in the engine, so they sit under captures; a side breaking is the 'end' event. */
export const EVENT_GROUPS: { id: EventGroup; label: string; kinds: SimEvent['kind'][] }[] = [
  { id: 'battles', label: 'Battles', kinds: ['battle', 'naval', 'air'] },
  { id: 'captures', label: 'Captures and sieges', kinds: ['capture', 'siege'] },
  { id: 'collapses', label: 'Collapses and end', kinds: ['rout', 'end'] },
  { id: 'forces', label: 'Reinforcements', kinds: ['mobilization', 'arrival'] },
  { id: 'supply', label: 'Supply', kinds: ['supply'] },
  { id: 'nuclear', label: 'Nuclear', kinds: ['nuclear'] },
  { id: 'weather', label: 'Weather', kinds: ['weather'] },
];

const GROUP_OF = new Map<string, EventGroup>(EVENT_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.id] as [string, EventGroup])));
export const groupOf = (kind: string): EventGroup | undefined => GROUP_OF.get(kind);

export interface EventFilter {
  /** Empty = every group. */
  groups: ReadonlySet<EventGroup>;
  /** '' = both sides; an event with side -1 (neutral or both) matches either side. */
  side: '' | '0' | '1';
  /** Case-insensitive substring of the text or the why. */
  query: string;
}

/** Matching events, newest first, at most `limit`; `matched` counts all matches. */
export function filterEvents(log: readonly SimEvent[], f: EventFilter, limit = 400): { list: SimEvent[]; matched: number } {
  const q = f.query.trim().toLowerCase();
  const list: SimEvent[] = [];
  let matched = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (f.groups.size > 0) { const g = groupOf(e.kind); if (!g || !f.groups.has(g)) continue; }
    if (f.side !== '' && e.side !== -1 && String(e.side) !== f.side) continue;
    if (q && !e.text.toLowerCase().includes(q) && !(e.why ?? '').toLowerCase().includes(q)) continue;
    matched++;
    if (list.length < limit) list.push(e);
  }
  return { list, matched };
}

/** Event count per group (kinds outside every group are not counted). */
export function groupCounts(log: readonly SimEvent[]): Record<EventGroup, number> {
  const out = Object.fromEntries(EVENT_GROUPS.map((g) => [g.id, 0])) as Record<EventGroup, number>;
  for (const e of log) { const g = groupOf(e.kind); if (g) out[g]++; }
  return out;
}

/** a / (a + b), or 0.5 when both are zero (a split bar then sits in the middle). */
export function share(a: number, b: number): number {
  const t = a + b;
  return t > 0 && Number.isFinite(t) ? a / t : 0.5;
}
