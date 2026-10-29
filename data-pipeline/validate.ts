// Validates all research output under data/. Schema checks (Ajv) plus the
// cross-field rules the schema cannot express. Exits non-zero on any error.
// Usage: tsx data-pipeline/validate.ts [--quiet]
import Ajv from 'ajv';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ERA_SPANS, PERSONNEL_ROLES } from '../src/types/schema';
import type { EraId, Snapshot } from '../src/types/schema';
import { battleSchema, coalitionSchema, doctrineSchema, mvSchema, snapshotSchema } from './schema';
import { ROOT } from './lib/util';

export interface Issue { file: string; level: 'error' | 'warn'; msg: string }

const DATA = join(ROOT, 'data');
const ajv = new Ajv({ allErrors: true, strict: false });
const vSnap = ajv.compile(snapshotSchema);
const vDoc = ajv.compile(doctrineSchema);
const vBattle = ajv.compile(battleSchema);
const vCoal = ajv.compile(coalitionSchema);
const vMv = ajv.compile(mvSchema);

export function documentedDerivations(): Set<string> {
  const md = readFileSync(join(DATA, 'SOURCES.md'), 'utf8');
  return new Set([...md.matchAll(/`derived:([a-z0-9-]+)`/g)].map((m) => m[1]));
}

export function listJson(dir: string): string[] {
  const d = join(DATA, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => join(d, f));
}

/** Walk every Est/MV-shaped leaf with its dotted path. */
export function walkEst(o: unknown, path: string, fn: (e: Record<string, unknown>, p: string) => void) {
  if (Array.isArray(o)) { o.forEach((x, i) => walkEst(x, `${path}[${i}]`, fn)); return; }
  if (!o || typeof o !== 'object') return;
  const r = o as Record<string, unknown>;
  if ('mid' in r && 'grade' in r) { fn(r, path); return; }
  for (const [k, v] of Object.entries(r)) walkEst(v, path ? `${path}.${k}` : k, fn);
}

const FRACTION_PATHS = [
  'demography.urbanization', 'military.mobilizationRatio', 'military.commandQuality',
  'military.cohesion', 'military.morale', 'economy.milSpendShare', 'economy.industrialShare',
  'economy.foodSurplus',
];

export function eraOf(year: number): EraId {
  for (const [era, [a, b]] of Object.entries(ERA_SPANS)) if (year >= a && year < b) return era as EraId;
  return year < -3000 ? 'bronze' : 'modern';
}

export function checkSnapshot(s: Snapshot, file: string, derived: Set<string>, issues: Issue[]) {
  const err = (msg: string) => issues.push({ file, level: 'error', msg });
  const warn = (msg: string) => issues.push({ file, level: 'warn', msg });
  if (s.id !== `${s.nationId}-${s.year}`) err(`id ${s.id} != ${s.nationId}-${s.year}`);
  if (eraOf(s.year) !== s.era) err(`era ${s.era} does not contain year ${s.year} (expected ${eraOf(s.year)})`);
  walkEst(s, '', (e, p) => {
    const { low, mid, high } = e as { low: number; mid: number; high: number };
    if (!(low <= mid && mid <= high)) err(`${p}: low<=mid<=high violated (${low}, ${mid}, ${high})`);
    if (low < 0) err(`${p}: negative value ${low}`);
    const src = String(e.source);
    if (src.startsWith('derived:') && !derived.has(src.slice(8))) err(`${p}: ${src} not documented in SOURCES.md`);
    if (FRACTION_PATHS.includes(p) || /\.(quality|training)$/.test(p)) {
      if (high > 1) err(`${p}: fraction above 1 (${high})`);
    }
    if (p.startsWith('tech.') && high > 10) err(`${p}: tech level above 10`);
    if (e.grade === 'A' && src.startsWith('derived:') && src !== 'derived:absent-in-era' && !/from|sum|area/.test(src)) {
      warn(`${p}: grade A on a derived value (${src})`);
    }
  });
  const m = s.military;
  const pSum = PERSONNEL_ROLES.reduce((a, r) => a + (m.forces[r]?.count.mid ?? 0), 0);
  if (pSum + m.supportPersonnel.mid > m.activePersonnel.mid * 1.02) {
    err(`force accounting: P roles ${Math.round(pSum)} + support ${Math.round(m.supportPersonnel.mid)} > active ${Math.round(m.activePersonnel.mid)}`);
  }
  if (m.activePersonnel.mid > m.mobilizable.mid) err(`active ${m.activePersonnel.mid} > mobilizable ${m.mobilizable.mid}`);
  const pop = s.demography.population.mid;
  if (m.mobilizable.mid > pop * 0.35) err(`mobilizable is ${(100 * m.mobilizable.mid / pop).toFixed(0)}% of population`);
  if (m.activePersonnel.mid > pop * 0.2) warn(`active personnel is ${(100 * m.activePersonnel.mid / pop).toFixed(1)}% of population`);
  if (s.year < 1945 && s.strategic.nuclearWarheads.high > 0) err('nuclear warheads before 1945');
  if (s.year < 1825 && s.logistics.railKm.high > 0) err('rail before 1825');
  const gdpCheck = s.economy.gdpPerCapita.mid * pop;
  if (s.economy.gdp.mid > 0 && Math.abs(Math.log(s.economy.gdp.mid / gdpCheck)) > 0.35) {
    warn(`gdp ${s.economy.gdp.mid.toExponential(2)} vs pop x gdppc ${gdpCheck.toExponential(2)}`);
  }
  if (!s.capital || !s.places) err('missing capital/places');
}

export function validateAll(): { issues: Issue[]; counts: Record<string, number> } {
  const issues: Issue[] = [];
  const derived = documentedDerivations();
  const counts: Record<string, number> = {};
  const ajvErr = (file: string, errors: unknown) =>
    issues.push({ file, level: 'error', msg: ajv.errorsText(errors as never, { separator: '; ' }).slice(0, 600) });

  const ids = new Set<string>();
  for (const f of listJson('raw/snapshots')) {
    let s: Snapshot;
    try { s = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { issues.push({ file: f, level: 'error', msg: `bad JSON: ${e}` }); continue; }
    if (!vSnap(s)) { ajvErr(f, vSnap.errors); continue; }
    if (ids.has(s.id)) issues.push({ file: f, level: 'error', msg: `duplicate id ${s.id}` });
    ids.add(s.id);
    checkSnapshot(s, f, derived, issues);
  }
  counts.snapshots = ids.size;

  const doctrineIds = new Set<string>();
  for (const f of listJson('doctrine')) {
    const d: { id: string } = JSON.parse(readFileSync(f, "utf8"));
    if (!vDoc(d)) { ajvErr(f, vDoc.errors); continue; }
    doctrineIds.add(d.id);
  }
  counts.doctrines = doctrineIds.size;

  for (const f of listJson('raw/snapshots')) {
    try {
      const s = JSON.parse(readFileSync(f, 'utf8'));
      if (doctrineIds.size && !doctrineIds.has(s.doctrineId)) issues.push({ file: f, level: 'warn', msg: `doctrine ${s.doctrineId} not found` });
    } catch { /* reported above */ }
  }

  counts.battles = 0;
  for (const f of listJson('battles')) {
    const b = JSON.parse(readFileSync(f, 'utf8'));
    if (!vBattle(b)) { ajvErr(f, vBattle.errors); continue; }
    counts.battles++;
  }

  const coalFile = join(DATA, 'coalitions.json');
  counts.coalitions = 0;
  if (existsSync(coalFile)) {
    for (const c of JSON.parse(readFileSync(coalFile, "utf8")) as { id: string; members: string[] }[]) {
      if (!vCoal(c)) { ajvErr(coalFile, vCoal.errors); continue; }
      for (const m of c.members) if (!ids.has(m)) issues.push({ file: coalFile, level: 'warn', msg: `${c.id}: member ${m} has no snapshot yet` });
      counts.coalitions++;
    }
  }

  counts.mechanicsConstants = 0;
  for (const f of listJson('mechanics')) {
    const m = JSON.parse(readFileSync(f, 'utf8'));
    walkEst(m, '', (e, p) => {
      counts.mechanicsConstants++;
      if (!vMv(e)) issues.push({ file: f, level: 'error', msg: `${p}: ${ajv.errorsText(vMv.errors)}` });
      const { low, mid, high } = e as { low: number; mid: number; high: number };
      if (!(low <= mid && mid <= high)) issues.push({ file: f, level: 'error', msg: `${p}: low<=mid<=high violated` });
      const src = String(e.source);
      if (src.startsWith('derived:') && !derived.has(src.slice(8))) issues.push({ file: f, level: 'error', msg: `${p}: ${src} undocumented` });
    });
  }
  return { issues, counts };
}

if (process.argv[1]?.endsWith('validate.ts')) {
  const { issues, counts } = validateAll();
  const quiet = process.argv.includes('--quiet');
  for (const i of issues) if (!quiet || i.level === 'error') console.log(`${i.level.toUpperCase()} ${i.file.replace(ROOT + '/', '')}: ${i.msg}`);
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(`validated ${JSON.stringify(counts)}: ${errors} errors, ${issues.length - errors} warnings`);
  process.exit(errors ? 1 : 0);
}
