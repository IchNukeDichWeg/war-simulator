// Generates a base 2026 snapshot for every modern state that has no researched
// snapshot yet. Hard data (population, urbanization, GDP, personnel, military
// spending, industry, rail, roads, land area, age structure, farm employment)
// comes from the World Bank (grade A/B; foodSurplus C, see foodSurplus()).
// Everything a database cannot give (force mix, ratings, tech) is copied from
// the median of RESEARCHED snapshots of the same region (derived:regional-analogy
// / derived:force-from-spending, grade D) and says so.
// Generated files carry the tag "auto-base" and are regenerated on every run;
// a researched file (no "auto-base" tag) is never touched.
// Usage: tsx data-pipeline/generate-modern.ts   (after fetch-worldbank.ts)
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Est, ForceEntry, Grade, RegionId, Snapshot, TechCategory, UnitRole } from '../src/types/schema';
import { PERSONNEL_ROLES } from '../src/types/schema';
import { FLAG_COAST, GRID_H, GRID_RES, GRID_W } from '../src/engine/terrainClasses';
import { ROOT, cachedFetch } from './lib/util';
import { bboxOf, pointInMulti } from './lib/geo';
import { resolveBorder } from './build';
import { TECH_CATEGORIES, UNIT_ROLES } from './schema';
import type { WbCountry } from './fetch-worldbank';

const SNAP_DIR = join(ROOT, 'data', 'raw', 'snapshots');
const WB_URL = 'https://data.worldbank.org/indicator/';
const FAS = 'https://fas.org/initiative/status-world-nuclear-forces/';
const NO_ARMY = 'https://en.wikipedia.org/wiki/List_of_countries_without_armed_forces';
const NE_PORTS = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_ports.geojson';
const NE_PLACES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_populated_places_simple.geojson';
const YEAR = 2026;
// Natural Earth files some states under another adm0_a3 than the World Bank's ISO3: Palestine is
// PSX there and PSE at the World Bank, so its places came back empty.
const NE_ADM0: Record<string, string> = { PSE: 'PSX' };
// The World Bank lists no capital (and lat/lon 0) for these; the fallback then put the capital at
// 0,0. Palestine: Ramallah, the administrative seat. Natural Earth marks it an "Admin-0 region
// capital" (as it does Gaza City) and files Jerusalem under Israel, so the sources do not give
// Jerusalem; the coordinates come from the Natural Earth place.
const SEAT: Record<string, string> = { PSE: 'Ramallah' };
// States listed without standing armed forces on the page above (fetched 2026-10-29).
const NO_ARMED_FORCES = new Set(['AND', 'CRI', 'DMA', 'GRD', 'ISL', 'KIR', 'LIE', 'MHL', 'MUS', 'FSM', 'MCO', 'NRU', 'PLW', 'PAN', 'LCA', 'VCT', 'WSM', 'SLB', 'TUV', 'VUT', 'VAT', 'KNA']);

const EA_SE = new Set(['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'TLS', 'VNM']);
const OCEANIA = new Set(['AUS', 'NZL', 'FJI', 'PNG', 'SLB', 'VUT', 'WSM', 'TON', 'KIR', 'TUV', 'NRU', 'PLW', 'MHL', 'FSM']);
const CENTRAL_ASIA = new Set(['KAZ', 'KGZ', 'TJK', 'TKM', 'UZB', 'MNG', 'AFG']);

function region(c: { iso3: string; region: string }): RegionId {
  if (CENTRAL_ASIA.has(c.iso3)) return 'central_asia';
  if (OCEANIA.has(c.iso3)) return 'oceania';
  if (EA_SE.has(c.iso3)) return 'southeast_asia';
  // The World Bank API pads some region names with a trailing space ("Sub-Saharan Africa "),
  // which once filed all of Africa and Latin America under europe: trim, and fail loudly.
  const reg = ({
    'Europe & Central Asia': 'europe', 'Middle East & North Africa': 'mena', 'Middle East, North Africa, Afghanistan & Pakistan': 'mena',
    'Sub-Saharan Africa': 'subsaharan_africa', 'South Asia': 'south_asia', 'East Asia & Pacific': 'east_asia',
    'Latin America & Caribbean': 'latin_america', 'North America': 'north_america',
  } as Record<string, RegionId>)[c.region.trim()];
  if (!reg) throw new Error(`${c.iso3}: unknown World Bank region "${c.region}"`);
  return reg;
}

const est = (mid: number, spread: number, grade: Grade, source: string, note: string): Est => ({
  low: Math.max(0, mid * (1 - spread)), mid, high: mid * (1 + spread), grade, source, note,
});
const median = (xs: number[]) => {
  const v = xs.filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

interface StateRow { iso3: string; nationId: string; name: string; status: string }

async function main() {
  const wb: WbCountry[] = JSON.parse(readFileSync(join(ROOT, 'data', 'raw', 'worldbank.json'), 'utf8')).countries;
  const states: StateRow[] = JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'states.json'), 'utf8')).states;
  // A specific modern profile whose appliesTo names the state wins over the archetype, as for
  // researched snapshots; it was once set by hand in denmark-2026 and lost on the next rerun.
  const doctrineDir = join(ROOT, 'data', 'doctrine');
  const specific = readdirSync(doctrineDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(doctrineDir, f), 'utf8')) as { id: string; appliesTo: string[]; era: string[]; archetype: boolean })
    .filter((d) => !d.archetype && d.era.includes('modern'));
  const wbBy = new Map(wb.map((c) => [c.iso3, c]));
  const grid = new Uint8Array(readFileSync(join(ROOT, 'public', 'data', 'terrain', 'grid.bin')));
  const ports = JSON.parse((await cachedFetch(NE_PORTS)).toString()).features as { properties: { name: string; scalerank: number }; geometry: { coordinates: number[] } }[];
  const placesAll = JSON.parse((await cachedFetch(NE_PLACES)).toString()).features as { properties: { name: string; adm0_a3: string; pop_max: number; latitude: number; longitude: number; featurecla: string } }[];

  // Researched modern analogues.
  const files = existsSync(SNAP_DIR) ? (await import('node:fs')).readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json')) : [];
  const all: Snapshot[] = files.map((f) => JSON.parse(readFileSync(join(SNAP_DIR, f), 'utf8')));
  const researched = all.filter((s) => s.year >= 2020 && !s.tags.includes('auto-base'));
  const researchedIds = new Set(researched.map((s) => s.nationId));
  if (researched.length < 3) throw new Error(`need >= 3 researched modern snapshots for analogies, have ${researched.length}`);

  // Remove stale auto-base files (state since researched, or list changed).
  for (const s of all) if (s.tags.includes('auto-base')) unlinkSync(join(SNAP_DIR, `${s.id}.json`));

  let written = 0;
  for (const st of states) {
    if (researchedIds.has(st.nationId)) continue;
    const c = wbBy.get(st.iso3);
    const reg = region(c ?? { iso3: st.iso3, region: '' });
    let pool = researched.filter((s) => s.region === reg);
    if (pool.length < 2) pool = researched;
    const poolNames = pool.map((s) => s.name).join(', ');
    const ana = (pick: (s: Snapshot) => number) => median(pool.map(pick));
    const anaNote = `median of researched ${reg} analogues (${poolNames}); not researched for this state`;
    const v = (k: string) => c?.values[k];
    const wbE = (k: string, code: string, spread: number, grade: Grade, scale = 1, what = '') => {
      const x = v(k);
      return x ? est(x.value * scale, spread, grade, `${WB_URL}${code}`, `World Bank ${code}, asOf ${x.year}${what}`) : null;
    };

    const pop = wbE('population', 'SP.POP.TOTL', 0.02, 'A');
    if (!pop) { console.log(`skip ${st.name}: no World Bank population (add a researched snapshot)`); continue; }
    const P = pop.mid;
    const urban = wbE('urbanPct', 'SP.URB.TOTL.IN.ZS', 0.05, 'A', 0.01) ?? est(ana((s) => s.demography.urbanization.mid), 0.3, 'D', 'derived:regional-analogy', anaNote);
    clampFraction(urban);
    const border = await resolveBorder(`ne:${st.iso3}`);
    const area = wbE('landKm2', 'AG.LND.TOTL.K2', 0.02, 'A') ?? est(0, 0, 'D', 'derived:regional-analogy', 'no World Bank land area; see border polygon');

    // Personnel
    // The list wins over the World Bank: its MS.MIL.TOTL.P1 counts these states' police
    // (Costa Rica's 10,000 Fuerza Publica), which the engine would field as an army.
    const noArmy = NO_ARMED_FORCES.has(st.iso3);
    const wbAf = v('armedForces');
    const active = noArmy
      ? est(0, 0, 'B', NO_ARMY, `no standing armed forces (police/coast guard only)${wbAf ? `; the World Bank's ${wbAf.value.toLocaleString('en-US')} (MS.MIL.TOTL.P1, ${wbAf.year}) are police or paramilitary` : ''}`)
      : wbE('armedForces', 'MS.MIL.TOTL.P1', 0.15, 'B', 1, '; IISS figure republished by the World Bank, may include paramilitary')
        ?? est(P * ana((s) => s.military.activePersonnel.mid / s.demography.population.mid), 0.5, 'D', 'derived:regional-analogy', `active per capita from ${anaNote}`);
    const A = active.mid;
    const ratio = (f: (s: Snapshot) => number) => ana(f);
    const reserves = est(A * ratio((s) => s.military.trainedReserves.mid / Math.max(1, s.military.activePersonnel.mid)), 0.6, 'D', 'derived:regional-analogy', `reserves/active ratio, ${anaNote}`);
    const support = est(A * ratio((s) => s.military.supportPersonnel.mid / Math.max(1, s.military.activePersonnel.mid)), 0.3, 'D', 'derived:regional-analogy', `support/active ratio, ${anaNote}`);
    const mobRatio = est(ratio((s) => s.military.mobilizationRatio.mid), 0.4, 'D', 'derived:regional-analogy', anaNote);
    const mobilizable = est(P * mobRatio.mid, 0.4, 'D', 'derived:mobilizable-from-ratio', 'population x mobilizationRatio');
    if (mobilizable.mid < A) { mobilizable.mid = A; mobilizable.low = Math.min(mobilizable.low, A); mobilizable.high = Math.max(mobilizable.high, A); }

    // Forces
    const milex = v('milexUsd')?.value ?? 0;
    const forces: Partial<Record<UnitRole, ForceEntry>> = {};
    const combat = Math.max(0, A - support.mid);
    const coastal = border ? hasCoast(border, grid) : true;
    for (const r of UNIT_ROLES as readonly UnitRole[]) {
      const present = pool.filter((s) => s.military.forces[r]);
      if (present.length < pool.length / 2) continue;
      if (!coastal && (r === 'ships_major' || r === 'ships_minor' || r === 'submarines')) continue;
      const q = est(median(present.map((s) => s.military.forces[r]!.quality.mid)), 0.3, 'D', 'derived:regional-analogy', anaNote);
      const t = est(median(present.map((s) => s.military.forces[r]!.training.mid)), 0.3, 'D', 'derived:regional-analogy', anaNote);
      for (const e of [q, t]) e.high = Math.min(1, e.high);
      let count: Est;
      if (PERSONNEL_ROLES.includes(r)) {
        const share = median(pool.map((s) => {
          const tot = PERSONNEL_ROLES.reduce((a, k) => a + (s.military.forces[k]?.count.mid ?? 0), 0);
          return tot ? (s.military.forces[r]?.count.mid ?? 0) / tot : 0;
        }));
        count = est(Math.round(combat * share), 0.4, 'D', 'derived:regional-analogy', `share ${(share * 100).toFixed(1)}% of combat personnel, ${anaNote}`);
      } else {
        if (!milex) continue;
        const perBn = median(present.map((s) => s.military.forces[r]!.count.mid / Math.max(1e-3, (s.economy.gdp.mid * s.economy.milSpendShare.mid) / 1e9)));
        const n = Math.round(perBn * (milex / 1e9));
        if (n < 1) continue;
        count = est(n, 0.6, 'D', 'derived:force-from-spending', `${perBn.toFixed(2)} per $bn milex (analogue median) x $${(milex / 1e9).toFixed(2)}bn (World Bank MS.MIL.XPND.CD); ${anaNote}`);
      }
      if (count.mid <= 0) continue;
      count.mid = Math.round(count.mid); count.low = Math.round(count.low); count.high = Math.round(count.high);
      forces[r] = { count, quality: q, training: t };
    }
    if (noArmy) for (const k of Object.keys(forces)) delete forces[k as UnitRole];

    const rating = (f: (s: Snapshot) => number) => { const e = est(ana(f), 0.3, 'D', 'derived:regional-analogy', anaNote); e.high = Math.min(1, e.high); return e; };
    const tech = Object.fromEntries((TECH_CATEGORIES as readonly TechCategory[]).map((k) => {
      const e = est(ana((s) => s.tech[k].mid), 0.15, 'D', 'derived:regional-analogy', anaNote);
      e.high = Math.min(10, e.high);
      return [k, e];
    })) as Record<TechCategory, Est>;

    const gdp21 = v('gdpPpp2021');
    const gdp = gdp21
      ? est(gdp21.value * 0.8306, 0.1, 'B', 'derived:ppp-rebase-2011', `World Bank NY.GDP.MKTP.PP.KD asOf ${gdp21.year} x 0.8306`)
      : est(P * ana((s) => s.economy.gdpPerCapita.mid), 0.5, 'D', 'derived:regional-analogy', `gdp per capita from ${anaNote}`);
    const gdppc = est(gdp.mid / P, 0.1, gdp.grade, gdp21 ? 'derived:ppp-rebase-2011' : 'derived:regional-analogy', 'gdp / population');
    const milShare = wbE('milexPctGdp', 'MS.MIL.XPND.GD.ZS', 0.15, 'A', 0.01) ?? est(noArmy ? 0 : ana((s) => s.economy.milSpendShare.mid), 0.5, 'D', 'derived:regional-analogy', anaNote);
    clampFraction(milShare);
    const ind = wbE('industryPct', 'NV.IND.TOTL.ZS', 0.1, 'A', 0.01) ?? est(ana((s) => s.economy.industrialShare.mid), 0.3, 'D', 'derived:regional-analogy', anaNote);
    // Males only, as every researched snapshot counts it (conscript-pool convention): counting
    // both sexes here once doubled the recruits of every auto-base state against its neighbours.
    const m1519 = v('male1519Pct'), mp = v('malePop');
    const cohort = m1519 && mp
      ? est(mp.value * m1519.value / 100 / 5, 0.05, 'B', 'derived:cohort-from-agegroup', `World Bank SP.POP.1519.MA.5Y x SP.POP.TOTL.MA.IN / 100 / 5, asOf ${m1519.year}. Males only (conscript-pool convention)`)
      : est(P * ana((s) => s.economy.annualCohort.mid / s.demography.population.mid), 0.4, 'D', 'derived:regional-analogy', `no World Bank age structure; males reaching military age per capita from ${anaNote}`);

    // World Bank IS.ROD.TOTL.KM is IRF data whose terms forbid redistribution, so roads come from
    // the regional analogy only (the engine does not read roadKm; see src/ui/engineUse.ts)
    const road = est(area.mid * ana((s) => s.logistics.roadKm.mid / Math.max(1, s.territory.areaKm2.mid)), 0.6, 'D', 'derived:regional-analogy', `road density per km2 from ${anaNote}`);
    const rail = wbE('railKm', 'IS.RRS.TOTL.KM', 0.05, 'A') ?? est(0, 0, 'D', 'derived:regional-analogy', 'no World Bank rail data; many of these states have little or no rail. Assumed 0.');
    const nPorts = border ? ports.filter((p) => p.properties.scalerank <= 8 && pointInMulti(p.geometry.coordinates[0], p.geometry.coordinates[1], border)).length : 0;
    const portsE = est(nPorts, 0.3, 'B', 'derived:ports-from-naturalearth', 'Natural Earth 10m ports inside the border polygon');
    const merchant = est(gdp.mid * ana((s) => s.logistics.merchantTonnage.mid / Math.max(1, s.economy.gdp.mid)), 0.8, 'D', 'derived:regional-analogy', `merchant tonnage per $ GDP from ${anaNote}`);
    if (!coastal) { merchant.low = merchant.mid = merchant.high = 0; merchant.note = 'landlocked'; }

    const places = placesAll
      .filter((p) => p.properties.adm0_a3 === (NE_ADM0[st.iso3] ?? st.iso3))
      .sort((a, b) => b.properties.pop_max - a.properties.pop_max)
      .slice(0, 8)
      .map((p) => ({ name: p.properties.name, lat: round4(p.properties.latitude), lon: round4(p.properties.longitude), kind: 'city' as const, population: p.properties.pop_max }));

    const snap: Snapshot = {
      id: `${st.nationId}-${YEAR}`, nationId: st.nationId, includes: [], name: st.name, year: YEAR, era: 'modern',
      region: reg, phase: 'current', tags: ['auto-base', 'modern-state', st.status],
      capital: capitalOf(st, c, places),
      places,
      territory: { border: border ? `ne:${st.iso3}` : 'none', areaKm2: area },
      demography: { population: pop, urbanization: urban },
      military: {
        activePersonnel: active, trainedReserves: noArmy ? est(0, 0, 'B', NO_ARMY, 'no armed forces') : reserves,
        supportPersonnel: noArmy ? est(0, 0, 'B', NO_ARMY, 'no armed forces') : support,
        mobilizationRatio: mobRatio, mobilizable, forces,
        commandQuality: rating((s) => s.military.commandQuality.mid),
        cohesion: rating((s) => s.military.cohesion.mid),
        morale: rating((s) => s.military.morale.mid),
      },
      tech,
      economy: {
        gdpPerCapita: gdppc, gdp, milSpendShare: milShare, industrialShare: ind,
        foodSurplus: foodSurplus(st.iso3, v('agriEmplPct')) ?? rating((s) => s.economy.foodSurplus.mid), annualCohort: cohort, production: {},
      },
      logistics: {
        roadKm: road, railKm: rail, majorPorts: portsE, merchantTonnage: merchant,
        supplyRangeKm: est(ana((s) => s.logistics.supplyRangeKm.mid), 0.4, 'D', 'derived:regional-analogy', anaNote),
        draftAnimals: est(0, 0, 'C', 'derived:regional-analogy', 'modern militaries do not rely on draft animals'),
      },
      strategic: { nuclearWarheads: est(0, 0, 'A', FAS, 'not a nuclear-armed state per FAS Status of World Nuclear Forces'), basesAbroad: [] },
      doctrineId: specific.find((d) => d.appliesTo.includes(st.nationId))?.id ?? (milex >= 20e9 ? 'archetype-modern-regional' : 'archetype-modern-small-state'),
      geography: { climate: 'see terrainMix', chokepoints: [], homeDefense: est(1.1, 0.1, 'D', 'derived:home-defense', 'rubric default: familiar terrain and local supply') },
      notes: `AUTO-GENERATED BASE SNAPSHOT. Population, economy, personnel and infrastructure from the World Bank (grade A/B). Force mix, ratings and tech copied from researched regional analogues (${poolNames}) and graded D. Replace with a researched snapshot when one exists.`,
    };
    writeFileSync(join(SNAP_DIR, `${snap.id}.json`), JSON.stringify(snap, null, 1));
    written++;
  }
  console.log(`wrote ${written} auto-base snapshots (${researchedIds.size} states researched)`);
}

function hasCoast(mp: number[][][][], grid: Uint8Array): boolean {
  const [w, s, e, n] = bboxOf(mp);
  const N = GRID_W * GRID_H;
  for (let r = Math.max(0, Math.floor((90 - n) / GRID_RES)); r <= Math.min(GRID_H - 1, Math.floor((90 - s) / GRID_RES)); r++) {
    for (let c = Math.max(0, Math.floor((w + 180) / GRID_RES)); c <= Math.min(GRID_W - 1, Math.floor((e + 180) / GRID_RES)); c++) {
      const i = r * GRID_W + c;
      if (grid[N + i] & FLAG_COAST && pointInMulti(-180 + (c + 0.5) * GRID_RES, 90 - (r + 0.5) * GRID_RES, mp)) return true;
    }
  }
  return false;
}
/** foodSurplus = 1 - a / s by its definition (data/SOURCES.md), a = agricultural employment share,
 *  in the format of the researched 2026 files. No calorie self-sufficiency is fetched here, so
 *  s = 1, which overstates a heavy importer and is why high stays at mid. The regional median it
 *  replaces ignored a: it put Albania (a about 31%) at the Europe median of 0.94. */
function foodSurplus(iso3: string, a: { value: number; year: number } | undefined): Est | null {
  if (!a) return null;
  const share = a.value / 100;
  // Low-side multiplier for farm households being larger than the employed count, in the bands
  // the researched 2026 files use: x1.5 below 5% farm employment, x1.3 to 25%, x1.2 above.
  const k = a.value < 5 ? 1.5 : a.value < 25 ? 1.3 : 1.2;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const mid = r2(1 - share);
  // Never 0 while agriculture exists (data/SOURCES.md), so the low side is floored at 0.01.
  const raw = r2(1 - share * k), low = Math.max(0.01, raw);
  return {
    low, mid, high: mid, grade: 'C', source: 'derived:snapshot-composite',
    note: `Formula: surplus = 1 - a/s, a = farm population share of consumers (proxy: agricultural employment share, World Bank SL.AGR.EMPL.ZS, ILO modelled, https://api.worldbank.org/v2/country/${iso3}/indicator/SL.AGR.EMPL.ZS), s = domestic production / consumption (calorie self-sufficiency). a = ${a.value.toFixed(2)}% (${a.year}). s = 1 assumed: no self-sufficiency figure is fetched for auto-base states, which overstates the value for a net food importer. Mid 1 - ${share.toFixed(3)}/1 = ${mid.toFixed(2)}. Low: a x ${k} (farm households larger than the employed count) = ${low.toFixed(2)}${raw < 0.01 ? ' (floored at 0.01: never 0 while agriculture exists)' : ''}. High: kept at mid (no s range).`,
  };
}

/** Fractions cannot exceed 1 however wide the range is. */
function clampFraction(e: Est) { e.high = Math.min(1, e.high); e.mid = Math.min(e.mid, e.high); e.low = Math.min(e.low, e.mid); }
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** World Bank capital, else the named seat among the state's places, else its largest place;
 *  never 0,0 (validate.ts rejects a place there). */
function capitalOf(st: StateRow, c: WbCountry | undefined, places: { name: string; lat: number; lon: number }[]): Snapshot['capital'] {
  if (c?.capital && (c.lat || c.lon)) return { name: c.capital, lat: c.lat, lon: c.lon, kind: 'capital' };
  const p = places.find((x) => x.name === SEAT[st.iso3]) ?? places[0];
  if (!p) throw new Error(`${st.iso3}: no World Bank capital and no Natural Earth place; add it to SEAT with a source`);
  return { name: p.name, lat: p.lat, lon: p.lon, kind: 'capital' };
}

main().catch((e) => { console.error(e); process.exit(1); });
