// Pure helpers behind the run panel (live dashboard, event log, result, Monte Carlo). No DOM,
// no store: unit-tested in tests/runStats.test.ts. Nothing here feeds back into the engine.

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

/** a / (a + b), or 0.5 when both are zero (a split bar then sits in the middle). */
export function share(a: number, b: number): number {
  const t = a + b;
  return t > 0 && Number.isFinite(t) ? a / t : 0.5;
}
