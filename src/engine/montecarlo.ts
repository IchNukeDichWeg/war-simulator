// Monte Carlo (ENGINE.md 13): N runs with seeds seed + i, no frames.
import type { EngineData, MonteCarloResult, Reason, RunResult } from './protocol';
import type { Scenario } from '../types/scenario';
import { buildSetup, type Setup, type SimOptions } from './setup';
import { simFromSetup, runToEnd } from './sim';

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

export function summarize(results: RunResult[]): MonteCarloResult {
  const n = results.length;
  const wins: [number, number, number] = [0, 0, 0];
  for (const r of results) wins[r.winner === 'draw' ? 2 : r.winner]++;
  const days = results.map((r) => r.endDay);
  const cas = [0, 1].map((s) => results.map((r) => r.stats[s].casualties + r.stats[s].lossesByCause.disease + r.stats[s].lossesByCause.starvation + r.stats[s].lossesByCause.exposure + r.stats[s].lossesByCause.desertion));
  // reasons most often ranked first; weight = share of runs, detail from the first run that had it
  const first = new Map<string, { count: number; r: Reason }>();
  for (const r of results) {
    const top = r.reasons[0];
    if (!top) continue;
    const k = `${top.factor}|${top.side}`;
    const e = first.get(k);
    if (e) e.count++; else first.set(k, { count: 1, r: top });
  }
  const topReasons = [...first.values()].sort((a, b) => b.count - a.count).map((e) => ({ ...e.r, weight: +(e.count / Math.max(1, n)).toFixed(3) }));
  return {
    runs: n,
    winProb: wins.map((w) => (n ? w / n : 0)) as [number, number, number],
    endDay: { p10: pct(days, 0.1), p50: pct(days, 0.5), p90: pct(days, 0.9) },
    casualties: [0, 1].map((s) => ({ p10: pct(cas[s], 0.1), p50: pct(cas[s], 0.5), p90: pct(cas[s], 0.9) })) as MonteCarloResult['casualties'],
    topReasons,
    results,
  };
}

/** Synchronous Monte Carlo for node CLIs and tests. */
export function monteCarlo(data: EngineData, scenario: Scenario, runs: number, onProgress?: (done: number, total: number) => void, opts?: SimOptions): MonteCarloResult {
  const setup: Setup = buildSetup(data, scenario, opts);
  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(runToEnd(simFromSetup(setup, (scenario.seed + i) >>> 0)));
    onProgress?.(i + 1, runs);
  }
  return summarize(results);
}
