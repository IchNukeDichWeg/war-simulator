// Single-constant robustness screen: every grade-D constant to its low and to its high, one at a
// time, on every case that passes at base, then the era breakpoints at both ends.
//   npx tsx scripts/robustness.ts --out validation/robustness-200.jsonl [--seeds 200] [--workers 0] [--resume]
// 20 seeds cannot resolve the gate's 60% line: at 400 seeds France 1940 reads 81% and Blenheim 74%,
// against 70% and 65% at 20 (QA round 7). So the default is 200 (margin about +/- 7% at the line).
// Different seed counts are different instruments: one output file per seed count, never pooled.
// Results are appended per task, so Ctrl-C prints the partial summary and --resume continues;
// resuming refuses a file made from other seeds or other data. --workers 0 = every core: runs have
// no clock, so density cannot move a result. Non-mechanics changes need `npm run data:build` first.
import { createHash } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { arg, dataDir, fmt, loadBattles, loadEngineData, Progress } from './lib/loadData';
import { breakpointTasks, constantTasks, evaluate, LINE, margin, summarize, type Result, type Task } from './lib/robustness';

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const seeds = Math.max(1, Number(arg(argv, 'seeds', '200')));

if (argv.includes('--worker')) {
  const data = loadEngineData(dir);
  const all = loadBattles(dir);
  process.on('message', (m: { task: Task; ids: string[] | null }) => {
    const cases = m.ids ? all.filter((c) => m.ids!.includes(c.id)) : all;
    process.send!(evaluate(m.task, data, cases, seeds));
  });
  process.on('SIGINT', () => process.exit(0));
} else {
  void main();
}

async function main() {
  const out = arg(argv, 'out');
  if (!out) { console.error('usage: robustness.ts --out FILE [--seeds 200] [--workers 0] [--resume] [--data DIR]'); process.exit(2); }
  const resume = argv.includes('--resume');
  const data = loadEngineData(dir);
  const cases = loadBattles(dir);
  // the oracle for "same instrument": a change to any constant or case changes this
  const dataHash = createHash('sha256').update(JSON.stringify([data.mechanics, cases])).digest('hex').slice(0, 16);
  const head = { seeds, dataHash };
  const done = new Map<string, Result>();
  if (existsSync(out)) {
    if (!resume) { console.error(`${out} exists; pass --resume to continue it or choose another --out`); process.exit(2); }
    const [first, ...rest] = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    if (first.seeds !== seeds || first.dataHash !== dataHash) {
      console.error(`${out} was made with ${first.seeds} seeds on data ${first.dataHash}; this run is ${seeds} on ${dataHash}. Not pooling them.`);
      process.exit(2);
    }
    for (const r of rest) done.set(r.key, r);
  } else writeFileSync(out, JSON.stringify(head) + '\n');

  const requested = Number(arg(argv, 'workers', '0'));
  const nw = requested > 0 ? requested : availableParallelism();
  const save = (r: Result) => { done.set(r.key, r); appendFileSync(out, JSON.stringify(r) + '\n'); };
  const pool: ChildProcess[] = Array.from({ length: nw }, () => fork(process.argv[1], [...argv, '--worker'], { execArgv: process.execArgv }));
  const stop = () => { for (const w of pool) w.kill(); };

  // Tasks finish in any order, so progress counts completions, not positions in the list.
  const run = (stage: string, tasks: Task[], ids: string[] | null) => new Promise<void>((resolve) => {
    const todo = tasks.filter((t) => !done.has(t.key));
    if (!todo.length) return resolve();
    const prog = new Progress(todo.length, stage);
    let next = 0, finished = 0;
    const give = (w: ChildProcess) => { if (next < todo.length) w.send({ task: todo[next++], ids }); };
    const onResult = (r: Result) => {
      save(r);
      prog.tick(++finished, r.key.slice(0, 34));
      if (finished === todo.length) { for (const w of pool) w.removeAllListeners('message'); resolve(); }
    };
    for (const w of pool) {
      w.on('message', (r: Result) => { onResult(r); give(w); });
      give(w);
    }
  });

  const report = () => {
    const base = done.get('BASE');
    if (!base) { console.log('no base result yet'); return; }
    const rest = [...done.values()].filter((r) => r.key !== 'BASE');
    const s = summarize(base, rest, seeds);
    const pc = (p: number) => `${(100 * p).toFixed(1)}% +/- ${(100 * margin(p, seeds)).toFixed(1)}`;
    const total = constantTasks(data.mechanics).length + breakpointTasks().length;
    console.log(`\n${seeds} seeds, data ${dataHash}, ${rest.length} of ${total} evaluations done`);
    for (const id of Object.keys(base.pct)) console.log(`  ${id.padEnd(26)} ${pc(base.pct[id])}${base.pct[id] >= LINE ? '' : '  under the line'}`);
    console.log(`\nWinners at base: ${s.passing.length}/${Object.keys(base.pct).length}`);
    console.log(`Flips (under ${100 * LINE}%, * = margin clear of the line):`);
    for (const f of s.flips) console.log(`  ${f.clear ? '*' : ' '} ${f.id.padEnd(26)} ${pc(f.pct).padEnd(16)} ${f.key}`);
    console.log(`Robust, grade-D constants:           ${s.robust.length} of ${s.passing.length}`);
    console.log(`Robust, also era breakpoints:        ${s.robustWithBreakpoints.length} of ${s.passing.length}`);
    for (const e of s.errors) console.log(`ERROR ${e}`);
  };
  process.on('SIGINT', () => { stop(); report(); console.log(`\npartial, continue with --resume: ${out}`); process.exit(130); });

  const t0 = Date.now();
  console.log(`${nw} workers, ${seeds} seeds, ${cases.length} cases, data ${dataHash}`);
  await run('stage 1/3 base', [{ kind: 'base', key: 'BASE' }], null);
  const passing = Object.entries(done.get('BASE')!.pct).filter(([, p]) => p >= LINE).map(([id]) => id);
  await run('stage 2/3 constants', constantTasks(data.mechanics), passing);
  await run('stage 3/3 breakpoints', breakpointTasks(), passing);
  stop();
  report();
  console.log(`\nfinished in ${fmt((Date.now() - t0) / 1000)}, results in ${out}`);
}
