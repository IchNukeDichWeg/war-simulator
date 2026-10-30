// Phase 3, step 1: enumerate the historical polities that still have no snapshot.
//   historical-basemaps world_<year>.geojson (cached in .cache) -> data/reference/phase3-polities.json
// Read-only with respect to everything else under data/. Writes no snapshots: step 2
// needs researched density inputs before any polity gets numbers.
//
// Pipeline:
//   1. every basemap year: union the features sharing a NAME (as build.ts resolveBorder
//      does), spherical area (lib/geo multiAreaKm2), centroid of the largest part;
//   2. drop non-state labels (EXCLUDE, then the INDIGENOUS_REGIONS rule) and polities that
//      already have a snapshot: exact border ref, same name within +/-50 years of the
//      snapshot year, or (added here) the same territory within +/-50 years under another
//      name (mutual raster overlap, see OVERLAP_SAME);
//   3. per polity name and engine era keep the basemap year with the largest area;
//   4. keep areaKm2 >= MIN_AREA_KM2 and print the candidate count at every THRESHOLDS value.
// Usage: tsx data-pipeline/phase3-enumerate.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERA_SPANS, type EraId, type Snapshot } from '../src/types/schema';
import { GRID_H, GRID_RES, GRID_W } from '../src/engine/terrainClasses';
import { resolveBorder } from './build';
import { MultiPolygon, bboxOf, multiAreaKm2, ringAreaKm2, toMulti } from './lib/geo';
import { ROOT, Progress, cachedFetch } from './lib/util';
import { listJson } from './validate';

const HB = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';
const OUT = join(ROOT, 'data', 'reference', 'phase3-polities.json');

/** The basemap years listed in data/RESEARCH_BRIEF.md (territory.border rule): 49 files.
 *  Upstream also ships bc123000, bc10000, bc8000, bc5000 and bc4000; all predate the bronze
 *  era start (-3000 in ERA_SPANS), so no engine era can use them. */
export const HB_YEARS = [
  'bc3000', 'bc2000', 'bc1500', 'bc1000', 'bc700', 'bc500', 'bc400', 'bc323', 'bc300', 'bc200',
  'bc100', 'bc1', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', '1100',
  '1200', '1279', '1300', '1400', '1492', '1500', '1530', '1600', '1650', '1700', '1715', '1783',
  '1800', '1815', '1878', '1880', '1900', '1914', '1920', '1930', '1938', '1945', '1960', '1994',
  '2000', '2010',
] as const;

/** A snapshot covers a basemap polity of the same name (or territory) within this many years. */
const SAME_NAME_WINDOW_YEARS = 50;
/** Same territory under another name (Qing Empire vs the "Manchu Empire" ref, "White Russia"
 *  vs USSR): at least this share of the polity lies inside the snapshot border AND at least
 *  this share of the snapshot border lies inside the polity, on the engine's 0.25 deg grid.
 *  Mutual majority, so a province inside an empire (one-sided overlap) is not matched. */
const OVERLAP_SAME = 0.5;
/** Overlap alone also pairs successor states on the same land (Han Empire over the Qin
 *  border, Seleucids over the Achaemenids, British Raj over India-1971), so before 1991 the
 *  territory match also needs a shared distinctive name token (Qing Empire ~ "Qing dynasty",
 *  Austria Hungary ~ "Austria-Hungary"). From 1991 every snapshot is a current state, so a
 *  mutual overlap there is a rename (Zaire, Burma, Byelarus, Swaziland). */
const OVERLAP_ALONE_FROM = 1991;
const GENERIC_TOKENS = new Set(('empire kingdom dynasty republic state states of the and sultanate caliphate khanate ' +
  'khaganate emirate union united federal democratic people\'s peoples great greater grand duchy principality tsardom ' +
  'holy new old upper lower north south east west northern southern eastern western i ii iii iv v era under').split(' '));
/** Basemap refs that are an existing snapshot under a name neither rule can see. */
const KNOWN_SAME: Record<string, { nationId: string; why: string }> = {
  'hb:1492:Mexihcah (Triple Alliance)': { nationId: 'aztec-empire', why: 'the Triple Alliance is the Aztec Empire (snapshot 1519)' },
  'hb:1930:White Russia': { nationId: 'ussr', why: 'the 1930 basemap labels the whole USSR polygon (19.5M km2) "White Russia"; the 1920 one (129k km2) is Byelorussia and stays' },
};

/** Candidate counts are reported at each of these minimum areas (km2). */
export const THRESHOLDS = [10_000, 25_000, 50_000, 100_000, 250_000];
/** Written cut-off. The engine grid is 0.25 deg (~28 km, ~770 km2 per cell at the equator,
 *  fewer km2 poleward), so 50,000 km2 is >= ~65 cells: room for a front, a rear and a
 *  capital region. 25,000 km2 is ~30 cells, one theater with no depth. */
export const MIN_AREA_KM2 = 50_000;

type Rule = { id: string; re: RegExp; reason: string; until?: number };
/** Non-state labels. Tested against the raw NAME; the first hit drops the polity in that
 *  basemap year (every year unless `until` is set: then only years < until). Named peoples
 *  that formed a polity (Vandals, Khazars, Uyghurs, Magyars, Asante) are deliberately NOT
 *  here: they stay as low-confidence candidates for step 2 to grade. */
export const EXCLUDE: Rule[] = [
  { id: 'unclaimed', re: /^\s*(\?)?\s*$/,
    reason: 'empty or "?" NAME: unclaimed or unlabelled land' },
  { id: 'uninhabited', re: /^Antarctica$/,
    reason: 'no permanent population or polity' },
  { id: 'subsistence', re: /hunter|gatherer|forag|fishers|fichers|shellfish|marine mammal|pastoral|nomad|farmers|herders|maïze/i,
    reason: 'subsistence-mode label (hunter-gatherers, pastoral nomads, farmers), not a polity' },
  { id: 'archaeological', re: /\bcultures?\b|\bcomplex\b|\bfocus\b|bronze age|iron age|neolithic|megalith|burials|\bcivilization\b|^Proto-|^(Andronovo|Afanasevo|Sintashta|Namazga|Únětice|Beaker|Jōmon|Yayoi|Hopewell|Adena|Copena|Anasazi|Hohokam|Mogollon|Dorset|Thule|Paleo-Inuit|Point Peninsula|Chinchoros|Valdivia|Chorrera|Norte Chico|Cycladic|Wankarani|Paracas|El Paraiso|Cuicuilco|Porter)$/i,
    reason: 'archaeological culture/horizon or reconstructed proto-population; no attested political organisation' },
  { id: 'aggregate', re: /tribes|peoples|chiefdoms|chieftainships|city-states|city states|\bminor\b|small states|warlords|\bstates\b|\bkingdoms\b|principalities|duchies|khanates|\bemirates\b|\bcolonies\b|\bsocieties\b|^(Rajputs|Arameans|Anglo-Saxons)$/i,
    reason: 'one polygon labelling several independent polities (states, kingdoms, tribes, city-states, warlords); no single actor' },
  { id: 'ethnolinguistic', re: /^(Bantu|Semites|Cushites|Kushites|Dravidians|Vedic Aryans|Austronesians|Papuans?|Polynesians|Malagasy|Malays?|Slavs|Balts|Celts|Arabs|Bedouins|Berbers|Tuaregs|Touareg|Khoisan|Aboriginal Tasmanians|Sinic|Mon-Khmer|Tibeto-Burmanese|Tungus|Siberians|Nguni|Sotho|Mandes|Finns|Ests|Chuds|Permians|Saami|Sami|Samis|Sámi|Samoyèdes|Inuit|Inupiat|Inupiaq|Ainus?|Maoris?|Māori|M\?ori|Arawaks|Tupis|Mayas|Maya Yucateco|Nahuas?|Nahua \(.*\)|Mixtecs|Hñähñu \(Otomí\)|Quechua|Aymara|Thai|Tibetans|Burmese|Koreans|Paleo-Koreans)$/i,
    reason: 'broad ethno-linguistic label spanning many communities, not one political unit' },
  { id: 'nonstate-people', re: /^(Cimerians|Celtiberians|Illyrians|Norsemen|Northmen|Saxons|Basques|Prussians|Bashkirs|Karakalpaks|Kryvichs|Polanes|Severians|Mordvinians|Veps|Karelians|Mari|Komi|Khanty|Nenets|Enets|Nganasan|Chukchi|Koryaks|Itelmen|Yukagir|Athabaskan|Athabascan|Innu|Beothuk|Boethuk|Ciboney|Taino|Chorotega|Azandes|Beja people|Oromo|Vazimba)$/i,
    reason: 'ethnonym for a society with no attested state in the basemap periods it appears in (Siberian/Arctic/forest peoples, pre-state European and Caribbean groups)' },
  { id: 'anachronistic-label', re: /^Papua New Guinea$/, until: 1975,
    reason: 'modern state name drawn over non-state societies before independence (1975)' },
  { id: 'anachronistic-label', re: /^Madagascar$/, until: 1960,
    reason: 'island-wide label drawn beside the Merina Kingdom before independence (1960)' },
  { id: 'anachronistic-label', re: /^Philippines$/, until: 1565,
    reason: 'archipelago label before the Spanish colony (1565): many barangays and sultanates' },
];
/** Polities whose NAME trips an EXCLUDE pattern but that are single states. */
const EXCLUDE_EXCEPTIONS = new Set([
  'United States', 'United States of America', 'Papal States', 'United Arab Emirates',
  'United States Virgin Islands',
]);

/** From 1492 the basemaps subdivide the Americas and Australia into hundreds of named
 *  Indigenous territories (land-claim style polygons, e.g. "Wiradjuri", "Choctaw
 *  (Oklahoma)") that are peoples' lands, not state borders. Inside these boxes (largest-part
 *  centroid) and from 1492 on, a polity is dropped unless it is a colony (SUBJECTO differs),
 *  carries a state-form word, is a modern state (states.json), or is in INDIGENOUS_KEEP.
 *  Mesoamerica and the Andes are outside the boxes or kept by name: they had states. */
const INDIGENOUS_REGIONS: { id: string; box: [number, number, number, number] }[] = [
  { id: 'Australia', box: [112, -45, 155, -10] },
  { id: 'North America north of the Tropic of Cancer', box: [-170, 23.5, -50, 85] },
  { id: 'South America', box: [-82, -56, -34, 13] },
];
const STATE_FORM = /empire|kingdom|confedera|republic|viceroyalty|dominion|united|provinces|\((UK|GB|France|FR|Spain|Portugal|Netherlands)\)/i;
/** Colonial units the basemap records with SUBJECTO = NAME (also read by generate-phase3.ts). */
export const COLONIAL_UNITS = new Set([
  "Rupert's Land", 'Louisiana', 'Essequibo', 'Cayenne', 'Dutch Guiana', 'French Guiana', 'Surinam',
]);
/** Pre-colonial or treaty-recognised polities inside the boxes. */
const NATIVE_STATES = new Set([
  'Chimú', 'Muisca', 'Iroquois', 'Ho-de-no-sau-nee-ga (Haudenosaunee)', 'Mapuche', 'Wallmapu (Mapuche)',
]);
const INDIGENOUS_KEEP = new Set([...COLONIAL_UNITS, ...NATIVE_STATES]);

export type Candidate = {
  name: string; subjecto: string; year: number; era: EraId;
  areaKm2: number; centroid: [number, number]; borderRef: string;
};
type Feature = { properties: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } | null };

export const yearOf = (tok: string) => (tok.startsWith('bc') ? -Number(tok.slice(2)) : Number(tok));

/** Era containing the year: start inclusive, end exclusive, except the last era's end. */
export function eraOf(year: number): EraId | null {
  const eras = Object.entries(ERA_SPANS) as [EraId, [number, number]][];
  for (const [i, [id, [a, b]]] of eras.entries()) {
    if (year >= a && (year < b || (i === eras.length - 1 && year <= b))) return id;
  }
  return null;
}

export const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const tokens = (s: string) => norm(s).replace(/['\u2019]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t));

export function exclusionOf(name: string | null | undefined, year: number): Rule | null {
  const n = name ?? '';
  if (EXCLUDE_EXCEPTIONS.has(n.trim())) return null;
  for (const e of EXCLUDE) if (e.re.test(n) && (e.until === undefined || year < e.until)) return e;
  return null;
}

/** Planar lon/lat centroid of the largest part's outer ring (shoelace). The largest part
 *  keeps an empire with overseas holdings from being centred in the sea; a ring crossing
 *  the antimeridian gets a wrong longitude, accepted for a reference listing. */
export function centroidOf(mp: MultiPolygon): [number, number] {
  let best = mp[0][0], bestA = -1;
  for (const p of mp) { const a = ringAreaKm2(p[0]); if (a > bestA) { bestA = a; best = p[0]; } }
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < best.length - 1; i++) {
    const [x1, y1] = best[i], [x2, y2] = best[i + 1];
    const c = x1 * y2 - x2 * y1;
    a2 += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  if (Math.abs(a2) < 1e-12) {
    const n = best.length;
    return [r(best.reduce((s, p) => s + p[0], 0) / n), r(best.reduce((s, p) => s + p[1], 0) / n)];
  }
  return [r(cx / (3 * a2)), r(cy / (3 * a2))];
}

/** Engine-grid cells (cell centre inside the polygon, even-odd per part, parts unioned),
 *  sorted, with each cell weighted by cos(lat) so shares are area shares. Scanline per row. */
export type Raster = { cells: Int32Array; w: Float64Array; total: number; bbox: [number, number, number, number] };
export function rasterize(mp: MultiPolygon): Raster {
  const set = new Set<number>();
  for (const poly of mp) {
    let s = 90, n = -90;
    for (const [, y] of poly[0]) { s = Math.min(s, y); n = Math.max(n, y); }
    const r0 = Math.max(0, Math.floor((90 - n) / GRID_RES)), r1 = Math.min(GRID_H - 1, Math.floor((90 - s) / GRID_RES));
    for (let row = r0; row <= r1; row++) {
      const yc = 90 - (row + 0.5) * GRID_RES;
      const xs: number[] = [];
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
          if ((y1 > yc) !== (y2 > yc)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.ceil((xs[k] + 180) / GRID_RES - 0.5), c1 = Math.floor((xs[k + 1] + 180) / GRID_RES - 0.5);
        for (let c = Math.max(0, c0); c <= Math.min(GRID_W - 1, c1); c++) set.add(row * GRID_W + c);
      }
    }
  }
  const cells = Int32Array.from(set).sort();
  const w = new Float64Array(cells.length);
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    w[i] = Math.cos(((90 - (Math.floor(cells[i] / GRID_W) + 0.5) * GRID_RES) * Math.PI) / 180);
    total += w[i];
  }
  return { cells, w, total, bbox: bboxOf(mp) };
}
function sharedWeight(a: Raster, b: Raster): number {
  let i = 0, j = 0, s = 0;
  while (i < a.cells.length && j < b.cells.length) {
    if (a.cells[i] === b.cells[j]) { s += a.w[i]; i++; j++; } else if (a.cells[i] < b.cells[j]) i++; else j++;
  }
  return s;
}
const bboxHit = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Existing snapshots: exact border refs, name -> snapshot years (names from the border
 *  refs, the snapshot name with any "(...)" qualifier removed, and states.json), and the
 *  snapshot list for the territory check. */
export function existingCoverage() {
  const states = JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'states.json'), 'utf8')).states as
    { nationId: string; name: string; unName?: string }[];
  const refs = new Set<string>();
  const years = new Map<string, number[]>();
  const add = (name: string, y: number) => { const k = norm(name); if (k) years.set(k, [...(years.get(k) ?? []), y]); };
  // Phase 3 output is derived from this enumeration, so it never counts as coverage.
  const snaps: Snapshot[] = listJson('raw/snapshots').map((f) => JSON.parse(readFileSync(f, 'utf8')) as Snapshot)
    .filter((s) => !s.tags.includes('phase3'));
  const snapTokens = new Map<string, Set<string>>(); // snapshot id -> distinctive name tokens
  for (const s of snaps) {
    const names = [s.name, s.name.replace(/\s*\(.*?\)\s*/g, ' ')];
    for (const st of states.filter((x) => x.nationId === s.nationId)) names.push(st.name, st.unName ?? '');
    if (s.territory.border.startsWith('hb:')) {
      for (const ref of s.territory.border.split(' + ').map((r) => r.trim())) {
        refs.add(ref);
        names.push(ref.split(':').slice(2).join(':'));
      }
    }
    for (const n of names) add(n, s.year);
    snapTokens.set(s.id, new Set(names.flatMap(tokens)));
  }
  const stateNames = new Set(states.flatMap((s) => [norm(s.name), norm(s.unName ?? '')]).filter(Boolean));
  return { refs, years, snaps, snapTokens, stateNames };
}

type Group = { name: string; tok: string; year: number; mp: MultiPolygon; subjecto: string; areaKm2: number };

export async function enumerate() {
  const { refs, years, snaps, snapTokens, stateNames } = existingCoverage();
  const dropped = new Map<string, Set<string>>(); // rule id -> distinct NAMEs
  const drop = (id: string, name: string) => { if (!dropped.has(id)) dropped.set(id, new Set()); dropped.get(id)!.add(name.trim() || '(empty)'); };
  const covered = { ref: new Set<string>(), name: new Set<string>(), known: [] as string[], territory: [] as string[] };
  const nationIds = new Set(snaps.map((s) => s.nationId));
  for (const [ref, k] of Object.entries(KNOWN_SAME)) if (!nationIds.has(k.nationId)) throw new Error(`KNOWN_SAME ${ref}: no snapshot of ${k.nationId}`);

  // Pass 1: read every basemap, group by NAME, apply the label rules.
  const groups: Group[] = [];
  let prog = new Progress('basemaps', HB_YEARS.length);
  for (const tok of HB_YEARS) {
    const year = yearOf(tok);
    const feats = JSON.parse((await cachedFetch(`${HB}/world_${tok}.geojson`)).toString()).features as Feature[];
    const byName = new Map<string, { mp: MultiPolygon; subj: Map<string, number> }>();
    for (const f of feats) {
      const name = (f.properties?.NAME as string | null | undefined) ?? '';
      const rule = exclusionOf(name, year);
      if (rule) { drop(rule.id, name); continue; }
      if (!f.geometry) continue;
      const mp = toMulti(f.geometry);
      const g = byName.get(name) ?? { mp: [] as MultiPolygon, subj: new Map<string, number>() };
      g.mp.push(...mp);
      const sj = String(f.properties?.SUBJECTO ?? '').trim();
      g.subj.set(sj, (g.subj.get(sj) ?? 0) + multiAreaKm2(mp));
      byName.set(name, g);
    }
    for (const [name, g] of byName) {
      // SUBJECTO of the polygons carrying most of the area; empty means none recorded.
      const subjecto = [...g.subj.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const grp: Group = { name, tok, year, mp: g.mp, subjecto, areaKm2: Math.round(multiAreaKm2(g.mp)) };
      if (year >= 1492) {
        const [cx, cy] = centroidOf(g.mp);
        const region = INDIGENOUS_REGIONS.find(({ box: [w, s, e, n] }) => cx >= w && cx <= e && cy >= s && cy <= n);
        const colony = subjecto !== '' && norm(subjecto) !== norm(name);
        if (region && !colony && !STATE_FORM.test(name) && !stateNames.has(norm(name)) && !INDIGENOUS_KEEP.has(name.trim())) {
          drop('indigenous-territory', name); continue;
        }
      }
      const ref = `hb:${tok}:${name}`;
      if (refs.has(ref)) { covered.ref.add(`${name.trim()} (${tok})`); continue; }
      if (KNOWN_SAME[ref]) { covered.known.push(`${ref} = ${KNOWN_SAME[ref].nationId}: ${KNOWN_SAME[ref].why}`); continue; }
      if ((years.get(norm(name)) ?? []).some((y) => Math.abs(y - year) <= SAME_NAME_WINDOW_YEARS)) { covered.name.add(`${name.trim()} (${tok})`); continue; }
      groups.push(grp);
    }
    prog.tick();
  }

  // Pass 2: same territory under another name. Only polities that can pass the smallest
  // threshold are rasterised; snapshot borders are rasterised once each.
  const snapRaster = new Map<string, Raster | null>();
  const minT = Math.min(...THRESHOLDS);
  const todo = groups.filter((g) => g.areaKm2 >= minT);
  const sameTerritory = new Set<Group>();
  prog = new Progress('territory check', Math.max(1, todo.length));
  for (const g of todo) {
    const near = snaps.filter((s) => s.territory.border !== 'none' && Math.abs(s.year - g.year) <= SAME_NAME_WINDOW_YEARS);
    let gr: Raster | null = null;
    const gTokens = tokens(g.name);
    for (const s of near) {
      if (g.year < OVERLAP_ALONE_FROM && !gTokens.some((t) => snapTokens.get(s.id)!.has(t))) continue;
      const key = s.territory.border;
      if (!snapRaster.has(key)) { const mp = await resolveBorder(key); snapRaster.set(key, mp && mp.length ? rasterize(mp) : null); }
      const sr = snapRaster.get(key);
      if (!sr || !bboxHit(bboxOf(g.mp), sr.bbox)) continue;
      gr ??= rasterize(g.mp);
      if (!gr.total) break;
      const shared = sharedWeight(gr, sr);
      if (shared / gr.total >= OVERLAP_SAME && shared / sr.total >= OVERLAP_SAME) {
        sameTerritory.add(g);
        covered.territory.push(`${g.name.trim()} (${g.tok}) = ${s.id} [${(shared / gr.total).toFixed(2)}/${(shared / sr.total).toFixed(2)}]`);
        break;
      }
    }
    prog.tick();
  }

  // Pass 3: one entry per polity name per era, the basemap year with the largest area.
  const best = new Map<string, Candidate>();
  const indigenous = new Set([...(dropped.get('indigenous-territory') ?? [])].map(norm));
  for (const g of groups) {
    if (sameTerritory.has(g)) continue;
    // SUBJECTO naming a dropped Indigenous territory (Aaniiih -> Gros Ventre) is not a colony.
    if (indigenous.has(norm(g.subjecto))) { drop('indigenous-territory', g.name); continue; }
    const era = eraOf(g.year)!;
    const key = `${era}|${norm(g.name)}`;
    const prev = best.get(key);
    if (!prev || g.areaKm2 > prev.areaKm2) {
      best.set(key, { name: g.name.trim(), subjecto: g.subjecto, year: g.year, era, areaKm2: g.areaKm2, centroid: centroidOf(g.mp), borderRef: `hb:${g.tok}:${g.name}` });
    }
  }
  const all = [...best.values()].sort((a, b) => a.year - b.year || b.areaKm2 - a.areaKm2);
  return { all, dropped, covered };
}

async function main() {
  const { all, dropped, covered } = await enumerate();
  const eras = Object.keys(ERA_SPANS) as EraId[];
  console.log(`\nalready covered by a snapshot (basemap polity-years): ${covered.ref.size} by border ref, ${covered.name.size} by name +/-${SAME_NAME_WINDOW_YEARS} y, ${covered.known.length} known renames, ${covered.territory.length} by territory overlap`);
  for (const t of covered.known) console.log(`  known: ${t}`);
  for (const t of covered.territory) console.log(`  territory: ${t}`);
  console.log('dropped as non-state (distinct NAMEs per rule):');
  const reasons = new Map<string, string>();
  for (const e of EXCLUDE) reasons.set(e.id, reasons.has(e.id) ? `${reasons.get(e.id)}; ${e.reason}` : e.reason);
  reasons.set('indigenous-territory', `Indigenous land polygons from 1492 in ${INDIGENOUS_REGIONS.map((r) => r.id).join(' / ')}`);
  for (const [id, why] of reasons) console.log(`  ${id.padEnd(20)} ${String(dropped.get(id)?.size ?? 0).padStart(5)}  ${why}`);
  const sovereign = (c: Candidate) => !c.subjecto || norm(c.subjecto) === norm(c.name);
  console.log(`\npolity-era candidates before the area cut: ${all.length}`);
  console.log(`${'min km2'.padStart(9)} ${'total'.padStart(6)} ${'sovrgn'.padStart(6)} ${'names'.padStart(6)} ${eras.map((e) => e.slice(0, 7).padStart(8)).join('')}`);
  for (const t of THRESHOLDS) {
    const c = all.filter((x) => x.areaKm2 >= t);
    const names = new Set(c.map((x) => norm(x.name))).size;
    console.log(`${t.toLocaleString('en-US').padStart(9)} ${String(c.length).padStart(6)} ${String(c.filter(sovereign).length).padStart(6)} ${String(names).padStart(6)} ${eras.map((e) => String(c.filter((x) => x.era === e).length).padStart(8)).join('')}`);
  }
  const out = all.filter((x) => x.areaKm2 >= MIN_AREA_KM2);
  // Kept by the +/-50 y rule but the same name already has a snapshot in that engine era.
  const { years } = existingCoverage();
  const sameEra = out.filter((c) => (years.get(norm(c.name)) ?? []).some((y) => eraOf(y) === c.era));
  console.log(`\nof the ${out.length} written, ${sameEra.length} share a name with a snapshot in the same era (outside +/-${SAME_NAME_WINDOW_YEARS} y): ${sameEra.map((c) => `${c.name} ${c.year}`).join(', ')}`);
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`\nwrote ${out.length} entries (areaKm2 >= ${MIN_AREA_KM2.toLocaleString('en-US')}) to ${OUT.replace(ROOT + '/', '')}`);
}

if (process.argv[1]?.endsWith('phase3-enumerate.ts')) main().catch((e) => { console.error(e); process.exit(1); });
