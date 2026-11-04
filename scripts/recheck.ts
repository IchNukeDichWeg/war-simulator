// Targeted recheck: one case under one robustness task, on more seeds than the campaign, to settle a
// reading the campaign's margin cannot (e.g. France 1940 at 59.5% +/- 6.8 on one constant).
//   npx tsx scripts/recheck.ts --case france-1940 --key attrition.starvationMultiplier=high --out FILE
//     [--seeds 2000] [--first-seed 201] [--workers 0] [--resume]
// --key is a campaign key: a constant (`path=low|high`), `breakpoint=0|1` or BASE.
// The default seeds start at 201, after the campaign's 1-200: those are the seeds that picked this
// reading out, so reusing them would bias the recheck toward the low value it is meant to test.
// --first-seed 1 --seeds 200 reproduces the campaign's own number, the oracle that this script
// evaluates the same thing. Chunks are appended as they finish; Ctrl-C prints the partial
// reading and --resume continues it. A file from another case, key, seed range or data is refused.
import { createHash } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { arg, dataDir, fmt, loadBattles, loadEngineData, Progress } from './lib/loadData';
import { breakpointTasks, constantTasks, LINE, margin, shareOf, tally, taskInputs, type Task } from './lib/robustness';

const CHUNK = 25; // seeds per worker message: small enough for a smooth ETA, big enough to keep IPC negligible

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const caseId = arg(argv, 'case');
const key = arg(argv, 'key');
const seeds = Math.max(1, Number(arg(argv, 'seeds', '2000')));
const firstSeed = Math.max(1, Number(arg(argv, 'first-seed', '201')));
const data = loadEngineData(dir);
const bc = loadBattles(dir).find((c) => c.id === caseId);
const task: Task | undefined = key === 'BASE' ? { kind: 'base', key: 'BASE' }
  : [...constantTasks(data.mechanics), ...breakpointTasks()].find((t) => t.key === key);

if (argv.includes('--worker')) {
  const { d, extra } = taskInputs(task!, data);
  process.on('message', (m: { from: number; count: number }) => {
    process.send!({ ...m, wins: tally(d, bc!, m.from, m.count, extra) });
  });
  process.on('SIGINT', () => process.exit(0));
} else {
  main();
}

function main() {
  const out = arg(argv, 'out');
  if (!out || !caseId || !key) { console.error('usage: recheck.ts --case ID --key KEY --out FILE [--seeds 2000] [--first-seed 201] [--workers 0] [--resume] [--data DIR]'); process.exit(2); }
  if (!bc) { console.error(`unknown case ${caseId}`); process.exit(2); }
  if (!task) { console.error(`unknown key ${key}: expected BASE, breakpoint=0|1 or a grade-D constant as path=low|high`); process.exit(2); }
  // same oracle as robustness.ts, so a recheck file names the campaign data it belongs to
  const dataHash = createHash('sha256').update(JSON.stringify([data.mechanics, loadBattles(dir)])).digest('hex').slice(0, 16);
  const head = { case: caseId, key, firstSeed, seeds, dataHash };
  const done = new Map<number, [number, number, number]>();
  if (existsSync(out)) {
    if (!argv.includes('--resume')) { console.error(`${out} exists; pass --resume to continue it or choose another --out`); process.exit(2); }
    const [first, ...rest] = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    if (JSON.stringify(first) !== JSON.stringify(head)) {
      console.error(`${out} was made for ${JSON.stringify(first)}; this run is ${JSON.stringify(head)}. Not pooling them.`);
      process.exit(2);
    }
    for (const r of rest) done.set(r.from, r.wins);
  } else writeFileSync(out, JSON.stringify(head) + '\n');

  const chunks: { from: number; count: number }[] = [];
  for (let s = firstSeed; s < firstSeed + seeds; s += CHUNK) chunks.push({ from: s, count: Math.min(CHUNK, firstSeed + seeds - s) });
  const todo = chunks.filter((c) => !done.has(c.from));
  const requested = Number(arg(argv, 'workers', '0'));
  const nw = Math.min(requested > 0 ? requested : availableParallelism(), Math.max(1, todo.length));

  const report = (final: boolean) => {
    let n = 0;
    const w: [number, number, number] = [0, 0, 0];
    for (const c of chunks) { const r = done.get(c.from); if (r) { n += c.count; w[0] += r[0]; w[1] += r[1]; w[2] += r[2]; } }
    if (!n) { console.log('no seeds done yet'); return; }
    const p = shareOf(bc, w, n), m = margin(p, n);
    const verdict = p >= LINE ? 'holds (at or over the line)' : p + m < LINE ? 'FLIPS, clear of the line' : 'under the line, not clear of it';
    // chunks finish out of order, so a partial run covers n of the range, not its first n seeds
    console.log(`\n${caseId} under ${key}, ${n} of seeds ${firstSeed}-${firstSeed + seeds - 1}${final ? '' : ' (partial)'}, data ${dataHash}`);
    console.log(`  historical winner ${(100 * p).toFixed(1)}% +/- ${(100 * m).toFixed(1)} over ${n} seeds -> ${verdict}`);
    console.log(`  side 0 / side 1 / draw: ${w.join(' / ')}`);
  };

  const t0 = Date.now();
  console.log(`${nw} workers, ${caseId}, ${key}, seeds ${firstSeed}-${firstSeed + seeds - 1}, data ${dataHash}`);
  if (!todo.length) { report(true); return; }
  const pool: ChildProcess[] = Array.from({ length: nw }, () => fork(process.argv[1], [...argv, '--worker'], { execArgv: process.execArgv }));
  const stop = () => { for (const w of pool) w.kill(); };
  process.on('SIGINT', () => { stop(); report(false); console.log(`\npartial, continue with --resume: ${out}`); process.exit(130); });

  const prog = new Progress(seeds, 'seeds');
  let next = 0, finishedChunks = 0, seedsDone = seeds - todo.reduce((a, c) => a + c.count, 0);
  const give = (w: ChildProcess) => { if (next < todo.length) w.send(todo[next++]); };
  for (const w of pool) {
    w.on('message', (r: { from: number; count: number; wins: [number, number, number] }) => {
      done.set(r.from, r.wins);
      appendFileSync(out, JSON.stringify(r) + '\n');
      seedsDone += r.count;
      prog.tick(seedsDone);
      if (++finishedChunks === todo.length) {
        stop();
        report(true);
        console.log(`\nfinished in ${fmt((Date.now() - t0) / 1000)}, results in ${out}`);
        return;
      }
      give(w);
    });
    give(w);
  }
}
