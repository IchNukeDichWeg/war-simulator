// Backtest every BattleCase in public/data/battles.json for N seeds.
//   npx tsx scripts/backtest.ts [--seeds 20] [--only cannae--216,waterloo-1815] [--data DIR] [--json out.json]
// Prints per case: historical winner win rate, model loss ratio vs historical, duration vs historical.
import { writeFileSync } from 'node:fs';
import { arg, dataDir, loadBattles, loadEngineData, Progress } from './lib/loadData';
import { runBattleCase } from '../src/engine/battleCase';

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const data = loadEngineData(dir);
let cases = loadBattles(dir);
const only = arg(argv, 'only');
if (only) { const set = new Set(only.split(',')); cases = cases.filter((c) => set.has(c.id)); }
const seeds = Math.max(1, Number(arg(argv, 'seeds', '20')));
const total = cases.length * seeds;
const prog = new Progress(total, 'runs');
const rows: Record<string, unknown>[] = [];
let done = 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 1);
const med = (xs: number[]) => { const s = xs.filter((x) => isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const lines: string[] = [];
for (const bc of cases) {
  const wins = [0, 0, 0];
  const lr: number[] = [], dur: number[] = [], l0: number[] = [], l1: number[] = [];
  let warnings: string[] = [];
  let error = '';
  for (let s = 0; s < seeds; s++) {
    try {
      const r = runBattleCase(data, bc, 1 + s);
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
  const row = {
    id: bc.id, kind: bc.kind, year: bc.year, histWinner: hw, winPct, wins, error,
    lossRatioModel: modelRatio, lossRatioHist: histRatio, lossRatioFactor: modelRatio / histRatio,
    losses0: med(l0), losses1: med(l1), histLosses: [h.losses[0].mid, h.losses[1].mid],
    durationModel: med(dur), durationHist: h.durationDays.mid, warnings,
  };
  rows.push(row);
  lines.push(error
    ? `${bc.id.padEnd(28)} ERROR ${error}`
    : `${bc.id.padEnd(28)} hist winner ${String(hw).padEnd(4)} won ${(winPct * 100).toFixed(0).padStart(3)}%  (s0/s1/draw ${wins.join('/')})  loss ratio s0:s1 model ${modelRatio.toFixed(2).padStart(7)} hist ${histRatio.toFixed(2).padStart(6)} (x${(modelRatio / histRatio).toFixed(2)})  losses ${Math.round(med(l0)).toLocaleString('en-US')}/${Math.round(med(l1)).toLocaleString('en-US')} vs ${Math.round(h.losses[0].mid).toLocaleString('en-US')}/${Math.round(h.losses[1].mid).toLocaleString('en-US')}  days model ${med(dur).toFixed(2)} hist ${h.durationDays.mid}`);
}
console.log('');
for (const l of lines) console.log(l);
const ok = rows.filter((r) => !r.error);
const hit = ok.filter((r) => (r.winPct as number) > 0.5).length;
console.log(`\n${hit}/${ok.length} cases: historical winner wins the majority of ${seeds} seeds.`);
// VALIDATION.md tolerance: winner >= 60% of seeds (historical draw: no side above 60%), median loss
// ratio and median duration within x3 of the historical mid (durations under 1 day count as 1 day)
const within3 = (x: number) => isFinite(x) && x >= 1 / 3 && x <= 3;
const passW = (r: typeof rows[number]) => (r.histWinner === 'draw'
  ? Math.max((r.wins as number[])[0], (r.wins as number[])[1]) / seeds <= 0.6
  : (r.winPct as number) >= 0.6);
const passR = (r: typeof rows[number]) => within3(r.lossRatioFactor as number);
const passD = (r: typeof rows[number]) => within3(Math.max(1, r.durationModel as number) / Math.max(1, r.durationHist as number));
const fails = (f: (r: typeof rows[number]) => boolean) => ok.filter((r) => !f(r)).map((r) => r.id).join(', ') || 'none';
console.log(`VALIDATION criteria: winner ${ok.filter(passW).length}/${ok.length}, loss ratio ${ok.filter(passR).length}/${ok.length}, duration ${ok.filter(passD).length}/${ok.length}`);
console.log(`  winner fails:   ${fails(passW)}`);
console.log(`  ratio fails:    ${fails(passR)}`);
console.log(`  duration fails: ${fails(passD)}`);
const out = arg(argv, 'json');
if (out) { writeFileSync(out, JSON.stringify(rows, null, 1)); console.log(`wrote ${out}`); }
