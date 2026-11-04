// Pure helpers behind the run panel (live dashboard, event log, result, Monte Carlo). No DOM,
// no store: unit-tested in tests/runStats.test.ts. Nothing here feeds back into the engine.
import type { LossCause, SimEvent } from '../engine/protocol';

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

// ------------------------------------------------------------------ Monte Carlo

/**
 * Wilson score interval for k successes in n trials (z = 1.96 gives 95%). Chosen over the
 * normal (Wald) interval because it stays inside [0, 1] and is still sensible at k = 0 or
 * k = n, which happens often here (a one-sided matchup wins every run). It covers only the
 * sampling error of a finite number of runs, not the model's or the data's uncertainty.
 */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (!(n > 0)) return { p: 0, lo: 0, hi: 1 };
  const kk = Math.max(0, Math.min(n, k));
  const p = kk / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { p, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** Wins per outcome [side 0, side 1, draw]: counted from the per-run results when they are all
 *  there, else recovered from the rounded probabilities. */
export function outcomeCounts(mc: { runs: number; winProb: [number, number, number]; results?: { winner: 0 | 1 | 'draw' }[] }): [number, number, number] {
  if (mc.results && mc.results.length === mc.runs) {
    const c: [number, number, number] = [0, 0, 0];
    for (const r of mc.results) c[r.winner === 'draw' ? 2 : r.winner]++;
    return c;
  }
  return mc.winProb.map((p) => Math.round(p * mc.runs)) as [number, number, number];
}

/** Equal-width histogram over [min, max]; integer data gets integer-aligned bins. */
export function histogram(values: readonly number[], maxBins = 12): { lo: number; width: number; counts: number[] } {
  const xs = values.filter(Number.isFinite);
  if (xs.length === 0) return { lo: 0, width: 1, counts: [] };
  let lo = Infinity, hi = -Infinity;
  for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const integer = xs.every(Number.isInteger);
  const span = hi - lo;
  if (span === 0) return { lo, width: 1, counts: [xs.length] };
  let width = span / maxBins;
  if (integer) width = Math.max(1, Math.ceil((span + 1) / maxBins));
  const bins = integer ? Math.ceil((span + 1) / width) : maxBins;
  const counts = new Array(bins).fill(0);
  for (const x of xs) counts[Math.min(bins - 1, Math.floor((x - lo) / width))]++;
  return { lo, width, counts };
}

/** Runs grouped by how they ended: end reasons that differ only in their numbers ("holds 45% of
 *  ..." and "holds 52% of ...") form one group shown with the numbers masked as N; a group whose
 *  runs all gave the same text keeps it verbatim. Most common first, ties by text. */
export function endReasonBreakdown(results: readonly { endReason: string; winner: 0 | 1 | 'draw' }[], top = 5): { reason: string; winner: 0 | 1 | 'draw'; count: number }[] {
  const m = new Map<string, { masked: string; exact: string | null; winner: 0 | 1 | 'draw'; count: number }>();
  for (const r of results) {
    const masked = r.endReason.replace(/\d+(\.\d+)?/g, 'N');
    const k = `${r.winner}|${masked}`;
    const e = m.get(k);
    if (!e) m.set(k, { masked, exact: r.endReason, winner: r.winner, count: 1 });
    else { e.count++; if (e.exact !== r.endReason) e.exact = null; }
  }
  return [...m.values()]
    .map((e) => ({ reason: e.exact ?? e.masked, winner: e.winner, count: e.count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, top);
}

/** a / (a + b), or 0.5 when both are zero (a split bar then sits in the middle). */
export function share(a: number, b: number): number {
  const t = a + b;
  return t > 0 && Number.isFinite(t) ? a / t : 0.5;
}

/** Causes inflicted by the enemy. The rest (disease, starvation, exposure, desertion) a side
 *  suffers on its own, so a loss ratio over all casualties credits the enemy with a starving
 *  army's deaths (Rome against the Swiss read 1,683 : 1 with almost no fighting). */
export const BATTLE_CAUSES: readonly LossCause[] = ['combat', 'pursuit', 'captured', 'air', 'naval', 'nuclear'];

export function splitLosses(by: Partial<Record<LossCause, number>> | undefined): { battle: number; other: number } {
  let battle = 0, other = 0;
  for (const [k, v] of Object.entries(by ?? {})) {
    if (BATTLE_CAUSES.includes(k as LossCause)) battle += v ?? 0; else other += v ?? 0;
  }
  return { battle, other };
}

/** Largest value so far. "% of start" overflowed when a side's army entered the theater in
 *  stages (the Swiss read 2,954% of a day-one strength of 5k); the peak cannot be exceeded. */
export function peakOf(series: readonly number[]): number {
  let m = 0;
  for (const v of series) if (v > m) m = v;
  return m;
}
