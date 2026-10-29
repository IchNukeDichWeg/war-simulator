// Run one scenario headless and print the result with its explanation.
//   npx tsx scripts/run-scenario.ts --preset rome-117-vs-spain-2026 [--seed 7] [--days 730]
//   npx tsx scripts/run-scenario.ts --file my-scenario.json
//   npx tsx scripts/run-scenario.ts --a rome-117 --b spain-2026 --bbox -12,33,8,46 [--month 5] [--tech native|equalized --eq 6]
//   [--data DIR] reads another data directory instead of public/data. --events prints the event log.
import { readFileSync } from 'node:fs';
import { arg, dataDir, fmt, loadEngineData, loadPresets, Progress } from './lib/loadData';
import { createSim } from '../src/engine/sim';
import type { Scenario } from '../src/types/scenario';
import { DEFAULT_RULES, DEFAULT_VICTORY } from '../src/types/scenario';

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const data = loadEngineData(dir);
let sc: Scenario;
const preset = arg(argv, 'preset');
const file = arg(argv, 'file');
if (file) sc = JSON.parse(readFileSync(file, 'utf8'));
else if (preset) {
  const p = loadPresets(dir).find((x) => x.id === preset);
  if (!p) { console.error(`no preset ${preset}; have: ${loadPresets(dir).map((x) => x.id).join(', ')}`); process.exit(1); }
  sc = p;
} else {
  const a = arg(argv, 'a'), b = arg(argv, 'b'), bbox = arg(argv, 'bbox');
  if (!a || !b || !bbox) { console.error('need --preset ID, --file F, or --a SNAP --b SNAP --bbox w,s,e,n'); process.exit(1); }
  const sa = data.snapshots.find((s) => s.id === a), sb = data.snapshots.find((s) => s.id === b);
  sc = {
    version: 1, id: `${a}-vs-${b}`, name: `${sa?.name ?? a} vs ${sb?.name ?? b}`, description: '',
    sides: [{ name: sa?.name ?? a, color: '#d04a3a', members: a.split(',') }, { name: sb?.name ?? b, color: '#3a78d0', members: b.split(',') }],
    excluded: [], techMode: (arg(argv, 'tech', 'native') as Scenario['techMode']), equalizedTech: Number(arg(argv, 'eq', '6')),
    theater: { name: 'custom', bbox: bbox.split(',').map(Number) as Scenario['theater']['bbox'] },
    startMonth: Number(arg(argv, 'month', '5')), rules: { ...DEFAULT_RULES }, victory: { ...DEFAULT_VICTORY }, seed: 1, overrides: [],
  };
}
if (arg(argv, 'seed')) sc.seed = Number(arg(argv, 'seed'));
if (arg(argv, 'days')) sc.victory.timeLimitDays = Number(arg(argv, 'days'));

const t0 = Date.now();
const sim = createSim(data, sc);
const S = sim.setup;
console.log(`${sc.name} | theater ${S.grid.cols}x${S.grid.rows} cells (${S.grid.cellDeg} deg) | formations ${S.seeds.length} | setup ${Date.now() - t0} ms`);
for (const w of S.warnings) console.log('  warning: ' + w);
const limit = sc.victory.timeLimitDays;
const prog = new Progress(limit, 'days');
const t1 = Date.now();
let lastTick = 0;
while (!sim.ended() && sim.day() < limit + 1) {
  sim.step(1);
  if (Date.now() - lastTick > 250 || sim.ended()) { lastTick = Date.now(); prog.tick(Math.min(limit, sim.day())); }
}
const el = (Date.now() - t1) / 1000;
const r = sim.result(true)!;
if (argv.includes('--events')) for (const e of sim.ctx.st.events) console.log(`  day ${e.day} [${e.kind}] ${e.text}${e.why ? ' -- ' + e.why : ''}`);
console.log(`\nResult: ${r.winner === 'draw' ? 'draw' : S.sideNames[r.winner] + ' won'} on day ${r.endDay.toFixed(1)}: ${r.endReason}`);
console.log(`Simulated ${sim.day()} days in ${fmt(el)} (${((el * 1000) / Math.max(1, sim.day())).toFixed(1)} ms/day)`);
for (const s of [0, 1] as const) {
  const st = r.stats[s];
  console.log(`  ${S.sideNames[s]}: personnel ${Math.round(st.personnel).toLocaleString('en-US')}, casualties ${Math.round(st.casualties).toLocaleString('en-US')} (${Object.entries(st.lossesByCause).filter(([, v]) => v > 0.5).map(([k, v]) => `${k} ${Math.round(v).toLocaleString('en-US')}`).join(', ')}), territory ${(st.territory * 100).toFixed(0)}%, morale ${st.morale.toFixed(2)}, supply ${st.supply.toFixed(2)}`);
}
console.log('Reasons:');
for (const x of r.reasons) console.log(`  ${(x.weight * 100).toFixed(0)}% ${x.factor} (favours ${S.sideNames[x.side]}): ${x.detail}`);
