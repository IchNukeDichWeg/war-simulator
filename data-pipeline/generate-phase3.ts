// Phase 3, step 2: derive a low-confidence snapshot for every enumerated basemap polity.
//   data/reference/phase3-polities.json (step 1) + data/reference/phase3-inputs.json (researched
//   inputs, methods in data/SOURCES.md "Phase 3 derivation inputs") -> data/raw/snapshots/<id>.json
// Nothing here is researched per polity: every number is a documented formula over the
// polity's own polygon (area, region, coast) and the inputs, or the median of the researched
// snapshots of its era (derived:era-peer-median). Files carry the tag "phase3" and are
// regenerated on every run; a file without that tag is never written or deleted.
// Usage: tsx data-pipeline/generate-phase3.ts   (after phase3-enumerate.ts)
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EraId, Est, ForceEntry, Grade, Place, RegionId, Snapshot, TechCategory, UnitRole } from '../src/types/schema';
import { PERSONNEL_ROLES } from '../src/types/schema';
import { FLAG_COAST, GRID_H, GRID_RES, GRID_W, T } from '../src/engine/terrainClasses';
import { resolveBorder } from './build';
import { MultiPolygon, toMulti } from './lib/geo';
import { ROOT, Progress, cachedFetch } from './lib/util';
import { COLONIAL_UNITS, type Candidate, eraOf, existingCoverage, norm, rasterize } from './phase3-enumerate';
import { TECH_CATEGORIES, UNIT_ROLES } from './schema';

const SNAP_DIR = join(ROOT, 'data', 'raw', 'snapshots');
const REF = join(ROOT, 'data', 'reference');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
const FAS = 'https://fas.org/initiative/status-world-nuclear-forces/';
const TAG = 'phase3';
/** An era x region cell is used for a peer median when it has this many researched snapshots
 *  (the rule of eraPeerRatios in the inputs); otherwise the whole era. */
const MIN_CELL = 3;
/** A role is fielded when at least this share of the peer pool fields it (generate-modern rule). */
const ROLE_PRESENT_SHARE = 0.5;
const NAVAL: UnitRole[] = ['ships_major', 'ships_minor', 'submarines'];
/** Roles that need horses: both cavalry roles and the horse-drawn chariot. */
const HORSE_ROLES: UnitRole[] = ['cavalry_heavy', 'cavalry_light', 'chariots'];
/** Fetched 2026-10-30: horses extinct in the Americas ~8,000-12,000 years ago, reintroduced from
 *  1493 (Columbus' second voyage); first horses in Australia 1788 (First Fleet). */
const HORSE_SRC: Partial<Record<RegionId, { url: string; note: string; contact: number }>> = {
  north_america: { url: 'https://en.wikipedia.org/wiki/Horses_in_the_United_States', note: 'no horses: extinct in the Americas ~8,000-12,000 years ago, reintroduced by the Spanish from 1493; no other draft animals before contact (inputs tech caps); llamas not counted', contact: 1493 },
  latin_america: { url: 'https://en.wikipedia.org/wiki/Horses_in_the_United_States', note: 'no horses: extinct in the Americas ~8,000-12,000 years ago, reintroduced by the Spanish from 1493; no other draft animals before contact (inputs tech caps); llamas not counted', contact: 1493 },
  oceania: { url: 'https://en.wikipedia.org/wiki/Brumby', note: 'no horses: first horses reached Australia in 1788 with the First Fleet', contact: 1788 },
};

// Koppen-Geiger grid (Beck et al. 2018, public/data/climate, the engine's weather zones):
// habitable land = engine land cells outside zone E; sea = engine water cells the map marks sea (0),
// which leaves lakes (Caspian, Great Lakes, Victoria) out because Beck classifies them as land.
const ZJ = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'climate', 'zones.json'), 'utf8')) as { zones: string[]; cols: number; resolutionDeg: number };
const ZONES = new Uint8Array(readFileSync(join(ROOT, 'public', 'data', 'climate', 'zones.bin')));
const KG_E = ZJ.zones.indexOf('E') + 1, KG_SEA = 0, KG_STEP = Math.round(ZJ.resolutionDeg / GRID_RES);
const kgOf = (cell: number) => ZONES[Math.floor(Math.floor(cell / GRID_W) / KG_STEP) * ZJ.cols + Math.floor((cell % GRID_W) / KG_STEP)];

/** Colonies and settler states whose basemap SUBJECTO equals their NAME, beyond COLONIAL_UNITS. */
const COLONIAL_NAME = /\((UK|GB|FR|France|Spain|Portugal|Netherlands|Belgium|Italy|IT|USA|Egypt)\)|colony|viceroyalty|portuguese|dutch|british|french|spanish|settlements|^(Angola|Natal|Griqualand West|Luisiana|Quebec|Guiana)$/i;
/** European-settler republics: not indigenous polities, not colonies. */
const SETTLER_STATES = new Set(['Transvaal', 'Orange Free State']);
/** Post-independence American states without a modern states.json name. */
const AMERICAN_SUCCESSOR = /^(United States|United Provinces|Kingdom of Brazil)/;

type In = { [k: string]: any };
const IN: In = JSON.parse(readFileSync(join(REF, 'phase3-inputs.json'), 'utf8'));
const GR: Grade[] = ['A', 'B', 'C', 'D'];
const worst = (...g: Grade[]) => GR[Math.max(...g.map((x) => GR.indexOf(x)))];
const cap = (g: Grade, at: Grade) => worst(g, at);
const r3 = (x: number) => Number(x.toPrecision(3));
const rnd = (x: number) => Math.round(x);
const mk = (low: number, mid: number, high: number, grade: Grade, source: string, note: string): Est =>
  ({ low: Math.min(low, mid), mid, high: Math.max(high, mid), grade, source, note });
const copy = (e: Est, note?: string): Est => ({ ...e, note: note ?? e.note });

/** Input table keyed by basemap year: linear between keys (log-linear for densities),
 *  clamped to the first and last key (inputs meta.yearRule). */
/** Notes carry a reference to the input (`inputs <path> <year>`), not its text: the full
 *  method lives in data/SOURCES.md and the full input note in phase3-inputs.json. */
function atYear(table: Record<string, Est>, year: number, log = false, label = 'inputs'): Est {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const at = (k: number) => ({ ...table[String(k)], note: `${label} ${k}` });
  if (year <= keys[0]) return at(keys[0]);
  if (year >= keys[keys.length - 1]) return at(keys[keys.length - 1]);
  if (table[String(year)]) return at(year);
  const hi = keys.find((k) => k > year)!, lo = keys[keys.indexOf(hi) - 1];
  const a = table[String(lo)], b = table[String(hi)], t = (year - lo) / (hi - lo);
  const f = (x: number, y: number) => (log && x > 0 && y > 0 ? Math.exp(Math.log(x) + t * (Math.log(y) - Math.log(x))) : x + t * (y - x));
  return { low: f(a.low, b.low), mid: f(a.mid, b.mid), high: f(a.high, b.high), grade: worst(a.grade, b.grade), source: a.source, note: `${label} ${year}, ${log ? 'log-linear' : 'linear'} ${lo}-${hi}` };
}

function quartiles(xs: number[]): [number, number, number] | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p: number) => { const i = p * (v.length - 1), lo = Math.floor(i); return v[lo] + (i - lo) * ((v[Math.min(lo + 1, v.length - 1)]) - v[lo]); };
  return [q(0.25), q(0.5), q(0.75)];
}

// ---- researched peers --------------------------------------------------------------------
const allSnaps: Snapshot[] = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(SNAP_DIR, f), 'utf8')));
const researched = allSnaps.filter((s) => !s.tags.includes('auto-base') && !s.tags.includes(TAG));
type Pool = { snaps: Snapshot[]; label: string };
function poolOf(era: EraId, region: RegionId): Pool {
  const cell = researched.filter((s) => s.era === era && s.region === region);
  if (cell.length >= MIN_CELL) return { snaps: cell, label: `${cell.length} ${era} ${region} peers` };
  const e = researched.filter((s) => s.era === era);
  return { snaps: e, label: `${e.length} ${era} peers` };
}
/** Era-peer median of a ratio: [q1, median, q3] and the note text. */
function peer(pool: Pool, what: string, f: (s: Snapshot) => number) {
  const q = quartiles(pool.snaps.map(f));
  return q ? { q, note: `median ${what}, ${pool.label}` } : null;
}
const PEER = 'derived:era-peer-median';
function peerEst(pool: Pool, what: string, f: (s: Snapshot) => number, fraction = false): Est | null {
  const p = peer(pool, what, f);
  if (!p) return null;
  const hi = fraction ? Math.min(1, p.q[2]) : p.q[2];
  return mk(r3(p.q[0]), r3(p.q[1]), r3(hi), 'D', PEER, p.note);
}
/** base x peer ratio, low x q1 and high x q3, grade D (the peer analogy dominates). */
function scaled(base: Est, pool: Pool, what: string, f: (s: Snapshot) => number, integer = true): Est | null {
  const p = peer(pool, what, f);
  if (!p) return null;
  const g = (x: number) => (integer ? rnd(x) : r3(x));
  return mk(g(base.low * p.q[0]), g(base.mid * p.q[1]), g(base.high * p.q[2]), 'D', PEER, `x ${p.note}`);
}

// ---- geography ---------------------------------------------------------------------------
const regionOfIso = new Map<string, RegionId>();
for (const [r, isos] of Object.entries(IN.meta.regionCountries as Record<string, string[]>)) for (const i of isos) regionOfIso.set(i, r as RegionId);
const REGIONS = Object.keys(IN.meta.regionCountries) as RegionId[];

/** OWID population by country, current borders (HYDE 3.3 to 1799, Gapminder v7 1800-1949,
 *  UN WPP 2024 from 1950): the series the inputs' regional densities are summed from. */
const OWID_POP = 'https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true';
const OWID_PAGE = 'https://ourworldindata.org/grapher/population';
/** Mutual overlap a polity and one modern country need for the country's population to be used. */
const MATCH_SHARE = 0.7;

async function owidPopulation(): Promise<Map<string, [number, number][]>> {
  const rows = (await cachedFetch(OWID_POP)).toString().trim().split('\n');
  if (rows[0] !== 'entity,code,year,population_historical') throw new Error(`unexpected OWID header: ${rows[0]}`);
  const m = new Map<string, [number, number][]>();
  for (const line of rows.slice(1)) {
    const f = line.split(',');
    const [code, year, v] = f.slice(-3);
    if (!code || v === '') continue;
    (m.get(code) ?? m.set(code, []).get(code)!).push([Number(year), Number(v)]);
  }
  for (const v of m.values()) v.sort((a, b) => a[0] - b[0]);
  return m;
}
/** Log-linear between observations; undefined outside the series. Basemap 1 BCE (-1) is OWID 0. */
function owidAt(series: [number, number][], year: number): number | undefined {
  const y = year === -1 ? 0 : year;
  if (!series.length || y < series[0][0] || y > series[series.length - 1][0]) return undefined;
  const k = series.findIndex((p) => p[0] >= y);
  if (series[k][0] === y) return series[k][1];
  const [y0, a] = series[k - 1], [y1, b] = series[k], t = (y - y0) / (y1 - y0);
  return a > 0 && b > 0 ? Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a))) : a + t * (b - a);
}

/** Natural Earth countries on the engine grid: region index and OWID country index per cell. */
async function countryGrids(owid: Map<string, unknown>): Promise<{ rgrid: Int8Array; cgrid: Int16Array; codes: string[] }> {
  const rgrid = new Int8Array(GRID_W * GRID_H).fill(-1), cgrid = new Int16Array(GRID_W * GRID_H).fill(-1);
  const codes: string[] = [];
  const fc = JSON.parse((await cachedFetch(NE)).toString()).features as { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[];
  for (const f of fc) {
    const p = f.properties;
    const r = regionOfIso.get(p.ADM0_A3) ?? regionOfIso.get(p.ISO_A3);
    // OWID uses ISO3 (OWID_KOS for Kosovo); Natural Earth has -99 in ISO_A3 for a few countries.
    const code = [p.ISO_A3, p.ADM0_A3, p.ISO_A3_EH, p.ADM0_A3 === 'KOS' ? 'OWID_KOS' : ''].find((x) => x && owid.has(x));
    let ci = -1;
    if (code) { ci = codes.indexOf(code); if (ci < 0) ci = codes.push(code) - 1; }
    if (!r && ci < 0) continue; // territories the inputs leave out of every region sum (TWN, ESH, XKX, ...)
    for (const c of rasterize(toMulti(f.geometry)).cells) { if (r) rgrid[c] = REGIONS.indexOf(r); if (ci >= 0) cgrid[c] = ci; }
  }
  return { rgrid, cgrid, codes };
}
const cellLat = (c: number) => 90 - (Math.floor(c / GRID_W) + 0.5) * GRID_RES;
const cellLon = (c: number) => -180 + ((c % GRID_W) + 0.5) * GRID_RES;

// ---- classification ----------------------------------------------------------------------
/** Polity type, used only where the inputs distinguish it: the indigenous-only tech caps
 *  (Americas to 1900, Sub-Saharan Africa to 1880) and the Americas/Oceania doctrine defaults,
 *  which are written for indigenous polities (colonial polygons take their metropole's).
 *  Outside those windows every non-colonial polity is a plain "state". */
const INDIGENOUS_UNTIL: Partial<Record<RegionId, number>> = { north_america: 1900, latin_america: 1900, subsaharan_africa: 1880, oceania: 1913 };
function kindOf(c: Candidate, region: RegionId, stateNames: Set<string>): 'colonial' | 'settler' | 'successor' | 'indigenous' | 'state' {
  const name = c.name;
  if ((c.subjecto && norm(c.subjecto) !== norm(name)) || COLONIAL_UNITS.has(name) || COLONIAL_NAME.test(name)) return 'colonial';
  if (SETTLER_STATES.has(name)) return 'settler';
  if ((region === 'north_america' || region === 'latin_america') && (stateNames.has(norm(name)) || AMERICAN_SUCCESSOR.test(name))) return 'successor';
  if (c.year <= (INDIGENOUS_UNTIL[region] ?? -Infinity)) return 'indigenous';
  return 'state';
}

/** inputs.doctrine[region][era], with the exceptions its reasons state: in the Americas and
 *  Oceania the pre-1914 defaults are written for indigenous polities, so a colonial,
 *  successor or settler polity there takes its (European) metropole's default; the
 *  north_america industrial reason names classical-infantry for indigenous nations. */
function doctrineOf(region: RegionId, era: EraId, kind: string): { doctrineId: string; reason: string } {
  const d = IN.doctrine as Record<string, Record<string, { doctrineId: string; reason: string }>>;
  const americasOceania = region === 'north_america' || region === 'latin_america' || region === 'oceania';
  const preWW = ['bronze', 'iron', 'medieval', 'gunpowder', 'industrial'].includes(era);
  if (americasOceania && preWW && kind !== 'indigenous') {
    if (region === 'north_america' && era === 'industrial') return d[region][era]; // its reason covers the US/Mexico/Canada
    if (region === 'latin_america' && era === 'industrial' && kind === 'successor') return d[region][era];
    return { doctrineId: d.europe[era].doctrineId, reason: `metropole (European) default for a ${kind} polity: ${d.europe[era].reason}` };
  }
  if (region === 'north_america' && era === 'industrial' && kind === 'indigenous') return { doctrineId: 'archetype-classical-infantry', reason: d[region][era].reason };
  return d[region][era];
}

/** tech.rule of the inputs: min(default, every applicable cap); grade of the term used. */
function techOf(year: number, region: RegionId, kind: string): Record<TechCategory, Est> {
  const def = IN.tech.default as Record<string, Record<TechCategory, Est>>;
  const out = {} as Record<TechCategory, Est>;
  const caps: { caps: Record<string, Est>; why: string }[] = [];
  const entries = IN.tech.regionalCaps as { regions: string[]; fromYear: number; toYear: number; appliesTo: string; caps: Record<string, Est> | string }[];
  for (const e of entries) {
    if (!e.regions.includes(region) || year < e.fromYear || year > e.toYear) continue;
    const indigenousOnly = /indigenous/.test(e.appliesTo);
    if (indigenousOnly && kind !== 'indigenous') continue;
    let c = e.caps;
    if (typeof c === 'string') {
      // "same caps as the pre-1493 entry" / "ships and logistics caps of the 500-1500 entry", grade D
      const base = entries.find((x) => x.regions.join() === e.regions.join() && typeof x.caps !== 'string' && x.toYear < e.fromYear)!;
      const fields = /ships and logistics/.test(c) ? ['ships', 'logistics'] : Object.keys(base.caps as object);
      c = Object.fromEntries(fields.map((k) => [k, { ...(base.caps as Record<string, Est>)[k], grade: 'D' as Grade }]));
    }
    caps.push({ caps: c, why: `${e.regions.join('/')} ${e.fromYear}..${e.toYear}${indigenousOnly ? ' indigenous' : ''}` });
  }
  for (const k of TECH_CATEGORIES as readonly TechCategory[]) {
    let best = atYear(Object.fromEntries(Object.entries(def).map(([y, v]) => [y, v[k]])), year, false, `inputs tech.default.${k}`);
    for (const c of caps) {
      const x = c.caps[k];
      if (x && x.mid < best.mid) best = copy(x, `inputs tech cap ${c.why} (default ${r3(best.mid)})`);
    }
    out[k] = { ...best, low: Math.min(best.low, best.mid), high: Math.min(10, Math.max(best.high, best.mid)) };
  }
  return out;
}

/** No horses before contact, every polity: the Americas before 1493 and Oceania before 1788
 *  (the fetched sources' dates). After contact horses spread at different dates per people
 *  (Mapuche, Comanche, Lakota became horse peoples), which is not modelled per people. */
function noHorses(year: number, region: RegionId) {
  const src = HORSE_SRC[region];
  return src && year < src.contact ? src : null;
}

/** Regional total population = inputs density x the regional land area its note states
 *  ("... people over <X>M km2"), so a polity is never larger than its region. */
const REGION_AREA: Record<string, Record<string, Est>> = {};
for (const [r, t] of Object.entries(IN.populationDensity as Record<string, Record<string, Est>>)) {
  REGION_AREA[r] = {};
  for (const [y, e] of Object.entries(t)) {
    const m = e.note.match(/people over ([\d.]+)M km2/);
    if (!m) throw new Error(`populationDensity.${r}.${y}: no land area in the note`);
    const a = Number(m[1]) * 1e6;
    REGION_AREA[r][y] = { low: a, mid: a, high: a, grade: e.grade, source: e.source, note: '' };
  }
}

const id0 = (c: Candidate, year: number) => `${c.name} ${year}`;

function slug(s: string) {
  return norm(s).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'polity';
}

// ---- main --------------------------------------------------------------------------------
async function main() {
  const polities: Candidate[] = JSON.parse(readFileSync(join(REF, 'phase3-polities.json'), 'utf8'));
  const { years: covered, stateNames } = existingCoverage();
  const states = JSON.parse(readFileSync(join(REF, 'states.json'), 'utf8')).states as { nationId: string }[];
  const takenIds = new Set([...allSnaps.filter((s) => !s.tags.includes(TAG)).map((s) => s.nationId), ...states.map((s) => s.nationId)]);
  const grid = new Uint8Array(readFileSync(join(ROOT, 'public', 'data', 'terrain', 'grid.bin')));
  const N = GRID_W * GRID_H;
  const owid = await owidPopulation();
  const { rgrid, cgrid, codes } = await countryGrids(owid);
  // Each country's habitable and land area on the grid (cell weight cos(lat), as rasterize).
  const cHab = new Float64Array(codes.length), cLand = new Float64Array(codes.length);
  for (let i = 0; i < N; i++) {
    const k = cgrid[i];
    if (k < 0 || grid[i] === T.water) continue;
    const w = Math.cos((cellLat(i) * Math.PI) / 180);
    cLand[k] += w;
    if (kgOf(i) !== KG_E) cHab[k] += w;
  }
  // Sea: every engine water cell connected (8-neighbour, through water) to a cell the Beck grid
  // marks as sea. Lakes form their own water bodies with no Beck sea cell (Caspian, Great Lakes,
  // Victoria, Baikal, Aral), so their shores are not sea access.
  const sea = new Uint8Array(N);
  {
    const stack: number[] = [];
    for (let i = 0; i < N; i++) if (grid[i] === T.water && kgOf(i) === KG_SEA) { sea[i] = 1; stack.push(i); }
    while (stack.length) {
      // 8-neighbour so a river estuary one diagonal step wide (St Lawrence below Quebec) stays sea.
      const i = stack.pop()!, row = Math.floor(i / GRID_W), col = i % GRID_W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr;
        if (rr < 0 || rr >= GRID_H) continue;
        const j = rr * GRID_W + ((col + dc + GRID_W) % GRID_W);
        if (!sea[j] && grid[j] === T.water) { sea[j] = 1; stack.push(j); }
      }
    }
  }

  // DECISIONS.md: a polity with a same-name snapshot in the same era is not derived again.
  const todo = polities.filter((c) => !(covered.get(norm(c.name)) ?? []).some((y) => eraOf(y) === c.era));
  const skipped = polities.length - todo.length;

  const slugOwner = new Map<string, string>();
  const written = new Set<string>();
  const stats = { matched: [] as string[], regionMoved: 0, capped: 0, horseless: [] as string[], kinds: {} as Record<string, number>, lowHab: [] as string[], bound: [] as string[], seaFlip: [] as string[] };
  const prog = new Progress('phase3 snapshots', todo.length);
  for (const c of todo) {
    const mp = (await resolveBorder(c.borderRef)) as MultiPolygon | null;
    if (!mp || !mp.length) throw new Error(`${c.borderRef}: border not found`);
    const ras = rasterize(mp);
    if (!ras.cells.length) throw new Error(`${c.borderRef}: no grid cell inside the polygon`);
    const year = c.year, era = c.era, A = c.areaKm2;

    // Habitable land: engine land cells outside Koppen zone E (Beck et al. 2018). Region: the
    // inputs' region of the centroid, read as the region holding most of the polity's people
    // (habitable cell area x regional density), so a Greenland-dominated polygon (Denmark-Norway)
    // is placed where its population lives, not where its largest part is.
    const dens = Object.fromEntries(REGIONS.map((r) => [r, atYear(IN.populationDensity[r], year, true).mid])) as Record<RegionId, number>;
    const weight = new Float64Array(REGIONS.length);
    let habW = 0, ownHab = 0, ownLand = 0;
    const interHab = new Map<number, number>(), interLand = new Map<number, number>();
    for (let i = 0; i < ras.cells.length; i++) {
      const cell = ras.cells[i];
      if (grid[cell] === T.water) continue;
      const k = cgrid[cell], e = kgOf(cell) === KG_E;
      if (k >= 0) {
        // the match counts only cells both maps call land (coastlines differ by a cell)
        ownLand += ras.w[i]; interLand.set(k, (interLand.get(k) ?? 0) + ras.w[i]);
        if (!e) { ownHab += ras.w[i]; interHab.set(k, (interHab.get(k) ?? 0) + ras.w[i]); }
      }
      if (e) continue;
      habW += ras.w[i];
      const ri = rgrid[cell];
      if (ri >= 0) weight[ri] += ras.w[i] * dens[REGIONS[ri]];
    }
    const habShare = habW / ras.total;
    if (habShare < 0.5) stats.lowHab.push(`${c.name} ${year} (${Math.round(100 * habShare)}%)`);
    let ri = weight.indexOf(Math.max(...weight));
    if (weight[ri] <= 0) {
      // polygon entirely outside mapped countries: nearest mapped cell to the centroid
      let bestD = Infinity;
      for (let cell = 0; cell < N; cell++) { if (rgrid[cell] < 0) continue; const d = (cellLat(cell) - c.centroid[1]) ** 2 + ((cellLon(cell) - c.centroid[0]) * Math.cos((c.centroid[1] * Math.PI) / 180)) ** 2; if (d < bestD) { bestD = d; ri = rgrid[cell]; } }
    }
    const region = REGIONS[ri];
    const centroidCell = Math.floor((90 - c.centroid[1]) / GRID_RES) * GRID_W + Math.floor((c.centroid[0] + 180) / GRID_RES);
    if (rgrid[centroidCell] >= 0 && REGIONS[rgrid[centroidCell]] !== region) stats.regionMoved++;

    // Interior point: the polity cell (in the main region) nearest the area-weighted mean of
    // those cells. Not a documented capital.
    let sx = 0, sy = 0, sw = 0;
    const inMain: number[] = [];
    for (let i = 0; i < ras.cells.length; i++) if (rgrid[ras.cells[i]] === ri || weight[ri] <= 0) { inMain.push(i); sx += cellLon(ras.cells[i]) * ras.w[i]; sy += cellLat(ras.cells[i]) * ras.w[i]; sw += ras.w[i]; }
    const pick = inMain.length ? inMain : [...ras.cells.keys()];
    const mx = sw ? sx / sw : c.centroid[0], my = sw ? sy / sw : c.centroid[1];
    let pc = ras.cells[pick[0]], pd = Infinity;
    for (const i of pick) { const cell = ras.cells[i]; const d = (cellLat(cell) - my) ** 2 + ((cellLon(cell) - mx) * Math.cos((my * Math.PI) / 180)) ** 2; if (d < pd) { pd = d; pc = cell; } }
    const pt = { lat: Math.round(cellLat(pc) * 1000) / 1000, lon: Math.round(cellLon(pc) * 1000) / 1000 };
    // Sea access: a border cell, or a cell next to one, is sea. Lake shores do not count
    // (FLAG_COAST marks them too).
    const isSea = (cell: number) => sea[cell] === 1;
    let coastal = false;
    for (const cell of ras.cells) {
      const row = Math.floor(cell / GRID_W), col = cell % GRID_W;
      const nb = [cell, row > 0 ? cell - GRID_W : -1, row < GRID_H - 1 ? cell + GRID_W : -1, row * GRID_W + ((col + 1) % GRID_W), row * GRID_W + ((col + GRID_W - 1) % GRID_W)];
      if (nb.some((x) => x >= 0 && isSea(x))) { coastal = true; break; }
    }
    if (coastal !== ras.cells.some((cell) => (grid[N + cell] & FLAG_COAST) !== 0)) stats.seaFlip.push(`${c.name} ${year}${coastal ? ' (sea, no coast flag)' : ''}`);

    const kind = kindOf(c, region, stateNames);
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    const pool = poolOf(era, region);

    // Area and population (derived:area-from-border, derived:state-density-factor).
    const area = mk(A, A, A, 'C', 'derived:area-from-border', `${c.borderRef} polygon`);
    // Population (derived:country-population-match): one modern country and the polity overlap
    // mutually by MATCH_SHARE of their habitable land (all land when the polity has none), so
    // the country's OWID population at the year stands for the polity. Band and grade are the
    // inputs' for that year (the regional densities are sums of the same series).
    const useHab = ownHab > 0;
    const inter = useHab ? interHab : interLand, own = useHab ? ownHab : ownLand, cTot = useHab ? cHab : cLand;
    let match: { code: string; pop: number; a: number; b: number } | null = null;
    for (const [k, w] of inter) {
      const a = w / own, b = cTot[k] > 0 ? w / cTot[k] : 0;
      if (a < MATCH_SHARE || b < MATCH_SHARE) continue;
      const pop = owidAt(owid.get(codes[k]) as [number, number][], year);
      if (pop != null && pop > 0) match = { code: codes[k], pop, a, b };
    }
    // Otherwise population on habitable land (A_h = A x habitable share), bounded by the region's total.
    const Ah = A * habShare;
    const sdf = IN.stateDensityFactor[year < 1991 ? 'historical' : 'modern'];
    const d = atYear(IN.populationDensity[region], year, true);
    const [lo, hi] = sdf.areaClampKm2 as [number, number];
    const lnA = Math.log(Math.min(hi, Math.max(lo, Ah)));
    const off: Est = sdf.regionOffset[region];
    const fac = (b: number) => Math.exp(b + sdf.slope.mid * lnA + off.mid);
    const ra = atYear(REGION_AREA[region], year).mid;
    const total = { low: d.low * ra, mid: d.mid * ra, high: d.high * ra };
    const raw = { low: Ah * d.mid * fac(sdf.intercept.low), mid: Ah * d.mid * fac(sdf.intercept.mid), high: Ah * d.mid * fac(sdf.intercept.high) };
    const bound = !match && (raw.mid > total.mid || raw.high > total.high || raw.low > total.low);
    if (bound) stats.bound.push(`${c.name} ${year}`);
    if (match) stats.matched.push(`${c.name} ${year}=${match.code}`);
    const popGrade = cap(worst(d.grade, sdf.intercept.grade, sdf.slope.grade, off.grade), 'C');
    const band = d.high / d.mid - 1;
    const population = match
      ? mk(rnd(match.pop * (1 - band)), rnd(match.pop), rnd(match.pop * (1 + band)), d.grade, 'derived:country-population-match',
        `OWID ${match.code} ${year} (${OWID_PAGE}); overlap ${Math.round(100 * match.a)}% of the polity, ${Math.round(100 * match.b)}% of ${match.code} (${useHab ? 'habitable' : 'all'} land); band +/-${Math.round(100 * band)}% as inputs populationDensity`)
      : mk(rnd(Math.min(raw.low, total.low)), rnd(Math.min(raw.mid, total.mid)), rnd(Math.min(raw.high, total.high)), popGrade,
      'derived:state-density-factor',
      `A_h ${rnd(Ah).toLocaleString('en-US')} km2 (${Math.round(100 * habShare)}% habitable) x ${region} ${year} density ${r3(d.mid)} x factor ${r3(fac(sdf.intercept.mid))}${bound ? `; bounded by the ${region} total ${r3(total.mid)}` : ''}`);
    const P = population;

    const ratios = IN.eraPeerRatios[era];
    const cell = ratios.byRegion?.[region];
    const ratioPath = `inputs eraPeerRatios.${era}${cell ? `.byRegion.${region}` : ''}`;
    const ratio = (k: string): Est => copy((cell?.[k] ?? ratios[k]) as Est, `${ratioPath}.${k}`);
    const urban = ratio('urbanization');
    urban.grade = 'D';
    const hyde = IN.urbanShareHyde?.[region] ? atYear(IN.urbanShareHyde[region], year) : null;
    urban.note += hyde ? `; HYDE cross-check ${r3(hyde.mid)}` : '';

    // Personnel (eraPeerRatios: activeShare, mobilizableShare).
    const aS = ratio('activeShare'), mS = ratio('mobilizableShare');
    if (aS.mid > mS.mid) throw new Error(`${era}/${region}: activeShare ${aS.mid} > mobilizableShare ${mS.mid}`);
    const active = mk(rnd(P.low * aS.low), rnd(P.mid * aS.mid), rnd(P.high * aS.high), 'D', PEER, `population x ${aS.mid} (${aS.note})`);
    const mobRatio = { ...mS, grade: 'D' as Grade };
    const mobilizable = mk(rnd(P.low * mS.low), rnd(P.mid * mS.mid), rnd(P.high * mS.high), 'D', 'derived:mobilizable-from-ratio', 'population x mobilizationRatio');
    const perActive = (s: Snapshot, v: number) => v / Math.max(1, s.military.activePersonnel.mid);
    const support = scaled(active, pool, 'supportPersonnel / activePersonnel', (s) => perActive(s, s.military.supportPersonnel.mid))!;
    const reserves = scaled(active, pool, 'trainedReserves / activePersonnel', (s) => perActive(s, s.military.trainedReserves.mid))!;

    // Forces: P roles share the combat personnel by the peer median shares (scaled to sum 1
    // if the medians exceed it); platform roles = active x the peer median per active.
    const forces: Partial<Record<UnitRole, ForceEntry>> = {};
    const combat = Math.max(0, active.mid - support.mid);
    const pShare = (s: Snapshot, r: UnitRole) => {
      const tot = PERSONNEL_ROLES.reduce((a, k) => a + (s.military.forces[k]?.count.mid ?? 0), 0);
      return tot ? (s.military.forces[r]?.count.mid ?? 0) / tot : 0;
    };
    const present = (r: UnitRole) => pool.snaps.filter((s) => s.military.forces[r]).length >= ROLE_PRESENT_SHARE * pool.snaps.length;
    // Role availability: no horse roles where the region had no horses; no ships without sea access.
    const horseless = noHorses(year, region);
    const available = (r: UnitRole) => present(r) && !(horseless && HORSE_ROLES.includes(r)) && !(!coastal && NAVAL.includes(r));
    const pRoles = PERSONNEL_ROLES.filter(present);
    const shares = Object.fromEntries(pRoles.map((r) => [r, quartiles(pool.snaps.map((s) => pShare(s, r)))![1]]));
    const shareSum = Object.values(shares).reduce((a, b) => a + b, 0);
    // Shares of the available roles keep the peer total (at most 1): a removed cavalry share
    // goes to the remaining roles in proportion.
    const availSum = pRoles.filter(available).reduce((a, r) => a + shares[r], 0);
    const scale = availSum > 0 ? Math.min(1, shareSum) / availSum : 0;
    const rating = (r: UnitRole, k: 'quality' | 'training') => {
      const has = { snaps: pool.snaps.filter((s) => s.military.forces[r]), label: pool.label };
      return peerEst(has, `${r} ${k} of fielding peers`, (s) => s.military.forces[r]![k].mid, true)!;
    };
    for (const r of UNIT_ROLES as readonly UnitRole[]) {
      if (!available(r)) continue;
      let count: Est;
      if (PERSONNEL_ROLES.includes(r)) {
        const sh = (shares[r] ?? 0) * scale;
        if (sh <= 0 || combat * sh < 1) continue;
        count = mk(rnd(combat * sh * (active.low / active.mid)), rnd(combat * sh), rnd(combat * sh * (active.high / active.mid)), 'D', PEER,
          `${(sh * 100).toFixed(1)}% of combat personnel, median share, ${pool.label}${Math.abs(scale - 1) > 1e-9 ? `, x${r3(scale)}${horseless ? ' (no horses)' : ''}` : ''}`);
      } else {
        const has = { snaps: pool.snaps.filter((s) => s.military.forces[r]), label: pool.label };
        const e = scaled(active, has, `${r} per active of fielding peers`, (s) => perActive(s, s.military.forces[r]!.count.mid));
        if (!e || e.mid < 1) continue;
        count = e;
      }
      forces[r] = { count, quality: rating(r, 'quality'), training: rating(r, 'training') };
    }

    // Economy.
    const gdppc = atYear(IN.gdpPerCapita[region], year, false, `inputs gdpPerCapita.${region}`);
    const gdp = mk(r3(P.low * gdppc.low), r3(P.mid * gdppc.mid), r3(P.high * gdppc.high), worst(P.grade, gdppc.grade), 'derived:gdp-from-pc', 'population x gdpPerCapita');
    const frac = (path: string, f: (s: Snapshot) => number) => peerEst(pool, path, f, true)!;
    const production: Partial<Record<UnitRole, Est>> = {};
    for (const r of Object.keys(forces) as UnitRole[]) {
      if (PERSONNEL_ROLES.includes(r)) continue;
      const has = pool.snaps.filter((s) => s.economy.production?.[r]);
      if (has.length < ROLE_PRESENT_SHARE * pool.snaps.length) continue;
      const e = scaled(gdp, { snaps: has, label: pool.label }, `production.${r} per $ GDP (snapshots with a figure)`, (s) => s.economy.production[r]!.mid / Math.max(1, s.economy.gdp.mid));
      if (e && e.mid >= 1) production[r] = e;
    }

    // Logistics.
    const perArea = (v: (s: Snapshot) => number) => (s: Snapshot) => v(s) / Math.max(1, s.territory.areaKm2.mid);
    const zero = (src: string, note: string, grade: Grade = 'A') => mk(0, 0, 0, grade, src, note);
    const railKm = year < 1825 ? zero('derived:absent-in-era', 'no railways before 1825')
      : scaled(area, pool, 'railKm per km2', perArea((s) => s.logistics.railKm.mid))!;
    const ports = coastal ? scaled(area, pool, 'majorPorts per km2', perArea((s) => s.logistics.majorPorts.mid))! : zero('derived:role-availability', 'no sea access', 'C');
    const merchant = coastal ? scaled(gdp, pool, 'merchantTonnage per $ GDP', (s) => s.logistics.merchantTonnage.mid / Math.max(1, s.economy.gdp.mid))! : zero('derived:role-availability', 'no sea access', 'C');

    const nuclear = year < 1945
      ? zero('derived:absent-in-era', 'no nuclear weapons before 1945')
      : mk(0, 0, 0, 'B', FAS, 'not among the states that have held nuclear weapons per FAS Status of World Nuclear Forces');

    const tech = techOf(year, region, kind);
    if (Object.values(tech).some((e) => e.source === 'derived:tech-regional-cap')) stats.capped++;
    if (horseless) stats.horseless.push(id0(c, year));
    const doc = doctrineOf(region, era, kind);

    let nationId = slug(c.name);
    if (takenIds.has(nationId)) nationId = `${nationId}-hb`;
    const owner = slugOwner.get(nationId);
    if (owner && owner !== c.name) nationId = `${nationId}-${slug(String(year))}`;
    slugOwner.set(nationId, c.name);
    const id = `${nationId}-${year}`;
    const place: Place = { name: `${c.name} interior point`, lat: pt.lat, lon: pt.lon, kind: 'capital' };

    const snap: Snapshot = {
      id, nationId, includes: [], name: c.name, year, era, region, phase: 'peak',
      tags: [TAG, 'derived', kind, ...(c.subjecto && norm(c.subjecto) !== norm(c.name) ? [`subject of ${c.subjecto}`] : [])],
      capital: place,
      places: [{ ...place, kind: 'city' }],
      territory: { border: c.borderRef, areaKm2: area },
      demography: { population, urbanization: urban },
      military: {
        activePersonnel: active, trainedReserves: reserves, supportPersonnel: support,
        mobilizationRatio: mobRatio, mobilizable, forces,
        commandQuality: frac('commandQuality', (s) => s.military.commandQuality.mid),
        cohesion: frac('cohesion', (s) => s.military.cohesion.mid),
        morale: frac('morale', (s) => s.military.morale.mid),
      },
      tech,
      economy: {
        gdpPerCapita: gdppc, gdp,
        milSpendShare: frac('milSpendShare', (s) => s.economy.milSpendShare.mid),
        industrialShare: frac('industrialShare', (s) => s.economy.industrialShare.mid),
        foodSurplus: frac('foodSurplus', (s) => s.economy.foodSurplus.mid),
        annualCohort: scaled(P, pool, 'annualCohort / population', (s) => s.economy.annualCohort.mid / Math.max(1, s.demography.population.mid))!,
        production,
      },
      logistics: {
        roadKm: scaled(area, pool, 'roadKm per km2', perArea((s) => s.logistics.roadKm.mid))!,
        railKm, majorPorts: ports, merchantTonnage: merchant,
        supplyRangeKm: peerEst(pool, 'supplyRangeKm', (s) => s.logistics.supplyRangeKm.mid)!,
        draftAnimals: horseless
          ? zero(horseless.url, horseless.note, 'C')
          : scaled(P, pool, 'draftAnimals / population', (s) => s.logistics.draftAnimals.mid / Math.max(1, s.demography.population.mid))!,
      },
      strategic: { nuclearWarheads: nuclear, basesAbroad: [] },
      doctrineId: doc.doctrineId,
      geography: {
        climate: 'see terrainMix', chokepoints: [],
        homeDefense: peerEst(pool, 'homeDefense', (s) => s.geography.homeDefense.mid)!,
      },
      notes: `PHASE 3 DERIVED SNAPSHOT, low confidence, not researched: every value is a formula over the ${c.borderRef} polygon (area, habitable share, region ${region}, sea access) and data/reference/phase3-inputs.json; methods in data/SOURCES.md "Phase 3 derivation inputs". SUBJECTO "${c.subjecto}"; classified ${kind}.${match ? ` Population: the modern country ${match.code} (OWID), which covers the same land.` : ''}${horseless ? ' No horses (cavalry, chariots, draft animals 0).' : ''}${coastal ? '' : ' No sea access (no ships).'} The capital is an interior point, NOT a documented capital. Doctrine ${doc.doctrineId}: ${doc.reason}`,
    };
    for (const k of ['commandQuality', 'cohesion', 'morale'] as const) if (!snap.military[k]) throw new Error(`${id}: no peer ${k}`);

    const file = join(SNAP_DIR, `${id}.json`);
    if (existsSync(file) && !(JSON.parse(readFileSync(file, 'utf8')).tags ?? []).includes(TAG)) throw new Error(`${file} exists and is not a phase3 file`);
    writeFileSync(file, JSON.stringify(snap, null, 1) + '\n');
    written.add(`${id}.json`);
    prog.tick();
  }
  // Remove stale phase3 files (polity dropped from the enumeration or renamed).
  let removed = 0;
  for (const s of allSnaps) if (s.tags.includes(TAG) && !written.has(`${s.id}.json`)) { unlinkSync(join(SNAP_DIR, `${s.id}.json`)); removed++; }

  const byEra: Record<string, number> = {};
  for (const c of todo) byEra[c.era] = (byEra[c.era] ?? 0) + 1;
  console.log(`wrote ${written.size} phase3 snapshots (${skipped} enumerated polities skipped: same-name snapshot in the same era; ${removed} stale removed)`);
  console.log(`per era: ${JSON.stringify(byEra)}`);
  console.log(`kinds: ${JSON.stringify(stats.kinds)}; region differs from the centroid's country region: ${stats.regionMoved}; snapshots with a regional tech cap: ${stats.capped}`);
  console.log(`no horses (cavalry, chariots, draft animals 0): ${stats.horseless.length}: ${stats.horseless.join(', ')}`);
  console.log(`sea access differs from the engine coast flag (lake-only shores): ${stats.seaFlip.length}: ${stats.seaFlip.join(', ')}`);
  console.log(`population from one matching modern country (OWID): ${stats.matched.length}: ${stats.matched.join(', ')}`);
  console.log(`population bounded by the regional total: ${stats.bound.length}: ${stats.bound.join(', ')}`);
  console.log(`${stats.lowHab.length} polities have less than half habitable (non-water, non-Koppen-E) area: ${stats.lowHab.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
