// Backtest every BattleCase in public/data/battles.json for N seeds.
//   npx tsx scripts/backtest.ts [--seeds 20] [--only cannae--216,waterloo-1815] [--data DIR] [--json out.json]
//   npx tsx scripts/backtest.ts --sweep modelRules.collapse.armyCollapseMorale 0.10,0.15,0.20,0.25
// Prints per case: historical winner win rate, model loss ratio vs historical, duration vs historical.
// --sweep sets one mechanics value (an MV's mid, or a plain number) to each listed value in turn and
// prints the VALIDATION counts at each; nothing is written to disk.
import { writeFileSync } from 'node:fs';
import { arg, dataDir, loadBattles, loadEngineData, Progress } from './lib/loadData';
import { runBattleCase } from '../src/engine/battleCase';
import type { EngineData } from '../src/engine/protocol';
import type { BattleCase } from '../src/types/mechanics';

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const data = loadEngineData(dir);
let cases = loadBattles(dir);
const only = arg(argv, 'only');
if (only) { const set = new Set(only.split(',')); cases = cases.filter((c) => set.has(c.id)); }
const seeds = Math.max(1, Number(arg(argv, 'seeds', '20')));
const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 1);
const med = (xs: number[]) => { const s = xs.filter((x) => isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

type Row = {
  id: string; kind: string; year: number; histWinner: 0 | 1 | 'draw'; winPct: number; wins: number[]; error: string;
  lossRatioModel: number; lossRatioHist: number; lossRatioFactor: number; losses0: number; losses1: number;
  histLosses: number[]; durationModel: number; durationHist: number; warnings: string[]; line: string;
};

function runAll(d: EngineData, list: BattleCase[], label: string): Row[] {
  const prog = new Progress(list.length * seeds, label);
  const rows: Row[] = [];
  let done = 0;
  for (const bc of list) {
    const wins = [0, 0, 0];
    const lr: number[] = [], dur: number[] = [], l0: number[] = [], l1: number[] = [];
    let warnings: string[] = [];
    let error = '';
    for (let s = 0; s < seeds; s++) {
      try {
        const r = runBattleCase(d, bc, 1 + s);
        wins[r.winner === 'draw' ? 2 : r.winner]++;
        lr.push(ratio(r.losses[0], r.losses[1]));
        l0.push(r.losses[0]); l1.push(r.losses[1]);
        dur.push(r.durationDays);
        if (s === 0) warnings = r.warnings;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        done += seeds - s;
        break;
      }
      done++;
      prog.tick(done, bc.id);
    }
    const h = bc.outcome;
    const hw = h.winner;
    const histRatio = ratio(h.losses[0].mid, h.losses[1].mid);
    const modelRatio = med(lr);
    const winPct = hw === 'draw' ? wins[2] / seeds : wins[hw] / seeds;
    const line = error
      ? `${bc.id.padEnd(28)} ERROR ${error}`
      : `${bc.id.padEnd(28)} hist winner ${String(hw).padEnd(4)} won ${(winPct * 100).toFixed(0).padStart(3)}%  (s0/s1/draw ${wins.join('/')})  loss ratio s0:s1 model ${modelRatio.toFixed(2).padStart(7)} hist ${histRatio.toFixed(2).padStart(6)} (x${(modelRatio / histRatio).toFixed(2)})  losses ${Math.round(med(l0)).toLocaleString('en-US')}/${Math.round(med(l1)).toLocaleString('en-US')} vs ${Math.round(h.losses[0].mid).toLocaleString('en-US')}/${Math.round(h.losses[1].mid).toLocaleString('en-US')}  days model ${med(dur).toFixed(2)} hist ${h.durationDays.mid}`;
    rows.push({
      id: bc.id, kind: bc.kind, year: bc.year, histWinner: hw, winPct, wins, error,
      lossRatioModel: modelRatio, lossRatioHist: histRatio, lossRatioFactor: modelRatio / histRatio,
      losses0: med(l0), losses1: med(l1), histLosses: [h.losses[0].mid, h.losses[1].mid],
      durationModel: med(dur), durationHist: h.durationDays.mid, warnings, line,
    });
  }
  return rows;
}

// VALIDATION.md tolerance: winner >= 60% of seeds (historical draw: no side above 60%), median loss
// ratio and median duration within x3 of the historical mid (durations under 1 day count as 1 day)
const within3 = (x: number) => isFinite(x) && x >= 1 / 3 && x <= 3;
const passW = (r: Row) => (r.histWinner === 'draw' ? Math.max(r.wins[0], r.wins[1]) / seeds <= 0.6 : r.winPct >= 0.6);
const passR = (r: Row) => within3(r.lossRatioFactor);
const passD = (r: Row) => within3(Math.max(1, r.durationModel) / Math.max(1, r.durationHist));
function counts(rows: Row[]) {
  const ok = rows.filter((r) => !r.error);
  const fails = (f: (r: Row) => boolean) => ok.filter((r) => !f(r)).map((r) => r.id).join(', ') || 'none';
  return {
    line: `winner ${ok.filter(passW).length}/${ok.length}, loss ratio ${ok.filter(passR).length}/${ok.length}, duration ${ok.filter(passD).length}/${ok.length}`,
    fails: [`  winner fails:   ${fails(passW)}`, `  ratio fails:    ${fails(passR)}`, `  duration fails: ${fails(passD)}`],
  };
}

/** Set `path` in a copy of the mechanics: an MV gets its mid replaced, a number is replaced. */
function withValue(d: EngineData, path: string, v: number): EngineData {
  const mech = structuredClone(d.mechanics) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  let o: any = mech;
  for (const k of keys.slice(0, -1)) {
    if (o == null || typeof o !== 'object' || !(k in o)) throw new Error(`--sweep: no mechanics path ${path}`);
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (o == null || !(last in o)) throw new Error(`--sweep: no mechanics path ${path}`);
  if (typeof o[last] === 'number') o[last] = v;
  else if (o[last] && typeof o[last].mid === 'number') o[last] = { ...o[last], mid: v };
  else throw new Error(`--sweep: ${path} is neither a number nor an MV (an era map needs a full era path, e.g. ...pursuitDisengageShare.iron)`);
  return { ...d, mechanics: mech as unknown as EngineData['mechanics'] };
}

const sweepAt = argv.indexOf('--sweep');
if (sweepAt >= 0) {
  const path = argv[sweepAt + 1];
  const values = (argv[sweepAt + 2] ?? '').split(',').filter(Boolean).map(Number);
  if (!path || !values.length || values.some((v) => !isFinite(v))) {
    console.error('usage: --sweep <mechanics.path> <v1,v2,...>');
    process.exit(2);
  }
  const table: string[] = [];
  for (const v of values) {
    const rows = runAll(withValue(data, path, v), cases, `${path}=${v}`);
    const c = counts(rows);
    table.push(`${path} = ${v}: ${c.line}`, ...c.fails);
  }
  console.log('');
  for (const l of table) console.log(l);
} else {
  const rows = runAll(data, cases, 'runs');
  console.log('');
  for (const r of rows) console.log(r.line);
  const ok = rows.filter((r) => !r.error);
  const hit = ok.filter((r) => r.winPct > 0.5).length;
  console.log(`\n${hit}/${ok.length} cases: historical winner wins the majority of ${seeds} seeds.`);
  const c = counts(rows);
  console.log(`VALIDATION criteria: ${c.line}`);
  for (const l of c.fails) console.log(l);
  const out = arg(argv, 'json');
  if (out) { writeFileSync(out, JSON.stringify(rows.map(({ line, ...r }) => (void line, r)), null, 1)); console.log(`wrote ${out}`); }
}
