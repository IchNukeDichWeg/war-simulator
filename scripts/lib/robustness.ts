// Pure logic of the single-constant robustness screen (scripts/robustness.ts): which constants it
// moves, what one evaluation does, and how the results become the VALIDATION.md gate count.
import { runBattleCase } from '../../src/engine/battleCase';
import type { EngineData } from '../../src/engine/protocol';
import type { BattleCase } from '../../src/types/mechanics';
import type { SimOptions } from '../../src/engine/setup';

export type Task =
  | { kind: 'base'; key: 'BASE' }
  | { kind: 'constant'; key: string; path: string[]; side: 'low' | 'high'; value: number; mid: number }
  | { kind: 'breakpoint'; key: string; quantile: number };

/** Result of one task: historical-winner share per case, or the error that stopped it. */
export type Result = { key: string; pct: Record<string, number>; error?: string };

const isMV = (o: Record<string, unknown>) => typeof o.mid === 'number' && typeof o.low === 'number' && typeof o.high === 'number';

/** The era breakpoints are drawn as one quantile per seed, so moving one era's alone would not be
 *  the model's own uncertainty; they run as breakpoint tasks at both ends, as QA rounds 5-7 did. */
const isBreakpoint = (path: string[]) => path[0] === 'modelRules' && path[1] === 'breakpoint';

/** Low and high of every grade-D constant with a range, walked in key order so a run is repeatable. */
export function constantTasks(mechanics: unknown): Task[] {
  const out: Task[] = [];
  const walk = (o: unknown, path: string[]) => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    if (isMV(r)) {
      if (r.grade !== 'D' || isBreakpoint(path)) return;
      const mid = r.mid as number;
      for (const side of ['low', 'high'] as const) {
        const value = r[side] as number;
        if (value !== mid) out.push({ kind: 'constant', key: `${path.join('.')}=${side}`, path, side, value, mid });
      }
      return;
    }
    for (const [k, v] of Object.entries(r)) walk(v, [...path, k]);
  };
  walk(mechanics, []);
  return out;
}

export const breakpointTasks = (): Task[] => [0, 1].map((quantile) => ({ kind: 'breakpoint', key: `breakpoint=${quantile}`, quantile }));

/** A copy of `o` with the MV at `path` having `mid` replaced; shares everything else. */
export function withMid(o: unknown, path: string[], mid: number): unknown {
  if (!path.length) return { ...(o as object), mid };
  const c: any = Array.isArray(o) ? [...o] : { ...(o as object) };
  c[path[0]] = withMid((o as any)[path[0]], path.slice(1), mid);
  return c;
}

/** Same pass rule as scripts/backtest.ts: winner at least 60% (historical draw: no side above 60%). */
function share(d: EngineData, bc: BattleCase, seeds: number, extra: Partial<SimOptions>): number {
  return shareOf(bc, tally(d, bc, 1, seeds, extra), seeds);
}

/** Wins of side 0, side 1 and draws over seeds first .. first+count-1. */
export function tally(d: EngineData, bc: BattleCase, first: number, count: number, extra: Partial<SimOptions>): [number, number, number] {
  const wins: [number, number, number] = [0, 0, 0];
  for (let s = first; s < first + count; s++) {
    const r = runBattleCase(d, bc, s, extra);
    wins[r.winner === 'draw' ? 2 : r.winner]++;
  }
  return wins;
}

/** Historical-winner share from a tally over n seeds. */
export function shareOf(bc: BattleCase, wins: [number, number, number], n: number): number {
  const hw = bc.outcome.winner;
  // a historical draw passes while no side is above 60%; shifted so the one line applies to both
  return hw === 'draw' ? 1.2 - Math.max(wins[0], wins[1]) / n : wins[hw] / n;
}

/** The data and run options one task changes: a constant moved to its low or high, or the era
 *  breakpoints pinned at one end. */
export function taskInputs(task: Task, data: EngineData): { d: EngineData; extra: Partial<SimOptions> } {
  const d = task.kind === 'constant' ? { ...data, mechanics: withMid(data.mechanics, task.path, task.value) as EngineData['mechanics'] } : data;
  return { d, extra: task.kind === 'breakpoint' ? { breakpointQuantile: task.quantile } : {} };
}

export function evaluate(task: Task, data: EngineData, cases: BattleCase[], seeds: number): Result {
  const { d, extra } = taskInputs(task, data);
  const pct: Record<string, number> = {};
  try {
    for (const bc of cases) pct[bc.id] = share(d, bc, seeds, extra);
    return { key: task.key, pct };
  } catch (e) {
    return { key: task.key, pct, error: e instanceof Error ? e.message : String(e) };
  }
}

export const LINE = 0.6;
/** 95% half-width of a share over n seeds. Normal approximation, enough to tell a flip that is
 *  clearly under the line from one the seed count cannot resolve. */
export const margin = (p: number, n: number) => 1.96 * Math.sqrt(Math.max(p * (1 - p), 1 / n) / n);

export type Flip = { id: string; key: string; pct: number; clear: boolean };
export type Summary = {
  passing: string[]; flips: Flip[]; robust: string[]; robustWithBreakpoints: string[]; errors: string[];
};

/** The gate count: cases at or over the line at base that stay there on every constant. `clear`
 *  marks a flip whose margin also sits under the line; it informs, it does not change the count. */
export function summarize(base: Result, results: Result[], seeds: number): Summary {
  const passing = Object.keys(base.pct).filter((id) => base.pct[id] >= LINE);
  const flips: Flip[] = [];
  for (const r of results) for (const id of passing) {
    const p = r.pct[id];
    if (p !== undefined && p < LINE) flips.push({ id, key: r.key, pct: p, clear: p + margin(p, seeds) < LINE });
  }
  flips.sort((a, b) => a.id.localeCompare(b.id) || a.pct - b.pct);
  const bad = (bp: boolean) => new Set(flips.filter((f) => bp || !f.key.startsWith('breakpoint=')).map((f) => f.id));
  const left = (s: Set<string>) => passing.filter((id) => !s.has(id));
  return {
    passing, flips, robust: left(bad(false)), robustWithBreakpoints: left(bad(true)),
    errors: results.filter((r) => r.error).map((r) => `${r.key}: ${r.error}`),
  };
}
