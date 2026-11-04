// Builds the runtime data from validated research output.
//   data/raw/snapshots/*.json -> public/data/snapshots.json (researched + auto-base, without the note/source
//                                prose) + snapshot-notes.json (that prose by id, src/ui/snapshotText.ts),
//                                data/nations.json, public/data/nations.json
//                                public/data/snapshots-phase3-<era>.json + snapshots-phase3-index.json (tag phase3,
//                                lazy-loaded by the UI per era; the index makes them searchable before loading)
//   border refs              -> public/data/borders.json (simplified MultiPolygons) + terrainMix
//   data/doctrine/*.json     -> public/data/doctrines.json
//   data/mechanics/*.json    -> public/data/mechanics.json
//   data/battles/*.json      -> public/data/battles.json
//   data/coalitions.json, data/presets.json -> public/data/
//   public/data/terrain/grid.bin -> public/data/terrain/grid.pack.gz (what the browser fetches,
//                                  src/ui/terrainPack.ts; Node keeps reading grid.bin)
//   public/data/climate/zones.bin -> public/data/climate/zones.bin.gz (same, plain gzip)
// Files that fail validation are skipped with a message, so one bad research
// file never breaks the app. Usage: tsx data-pipeline/build.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Nation, Snapshot } from '../src/types/schema';
import type { Phase3Entry } from '../src/ui/data';
import { GRID_H, GRID_RES, GRID_W, TERRAIN_CLASSES } from '../src/engine/terrainClasses';
import { ROOT, Progress, cachedFetch } from './lib/util';
import { MultiPolygon, bboxOf, multiAreaKm2, pointInMulti, simplifyMulti, toMulti } from './lib/geo';
import { confidence, listJson, validateAll } from './validate';
import { packTerrain } from '../src/ui/terrainPack';
import { splitSnapshotText } from '../src/ui/snapshotText';
import { ERAS } from './schema';

const DATA = join(ROOT, 'data');
const PUB = join(ROOT, 'public', 'data');
// pinned to the upstream commit the shipped borders were built from: on master the world files
// keep changing (five differed by 2026-11), so a clean clone rebuilt different borders
const HB = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/7bed003529d66488532c3a3256568b9725602bbf/geojson';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
// 0.05 deg (~5 km) keeps borders recognisable at theater zoom while keeping borders.json small.
const SIMPLIFY_DEG = 0.05;

type Feature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const fileCache = new Map<string, Feature[]>();

async function features(url: string): Promise<Feature[]> {
  if (!fileCache.has(url)) fileCache.set(url, JSON.parse((await cachedFetch(url)).toString()).features);
  return fileCache.get(url)!;
}

/** Resolve "hb:<year>:<NAME>" or "ne:<ISO3>" to a MultiPolygon. Several refs joined
 *  with " + " are unioned (e.g. a core polygon plus a protectorate). */
export async function resolveBorder(ref: string): Promise<MultiPolygon | null> {
  if (ref.includes(' + ')) {
    const parts = await Promise.all(ref.split(' + ').map((r) => resolveBorder(r.trim())));
    if (parts.some((p) => !p)) return null;
    return parts.flatMap((p) => p!);
  }
  if (ref.startsWith('hb:')) {
    const [, year, ...rest] = ref.split(':');
    const name = rest.join(':');
    const feats = await features(`${HB}/world_${year}.geojson`);
    const hits = feats.filter((f) => f.properties.NAME === name && f.geometry);
    if (!hits.length) return null;
    return hits.flatMap((f) => toMulti(f.geometry));
  }
  if (ref.startsWith('ne:')) {
    const iso = ref.slice(3);
    const feats = await features(NE);
    const hit = feats.find((f) => f.properties.ADM0_A3 === iso || f.properties.ISO_A3 === iso);
    return hit ? toMulti(hit.geometry) : null;
  }
  return null;
}

function terrainMix(mp: MultiPolygon, grid: Uint8Array): Record<string, number> {
  const [w, s, e, n] = bboxOf(mp);
  const counts = new Array(TERRAIN_CLASSES.length).fill(0);
  let total = 0;
  const r0 = Math.max(0, Math.floor((90 - n) / GRID_RES)), r1 = Math.min(GRID_H - 1, Math.floor((90 - s) / GRID_RES));
  const c0 = Math.max(0, Math.floor((w + 180) / GRID_RES)), c1 = Math.min(GRID_W - 1, Math.floor((e + 180) / GRID_RES));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const lat = 90 - (r + 0.5) * GRID_RES, lon = -180 + (c + 0.5) * GRID_RES;
    if (!pointInMulti(lon, lat, mp)) continue;
    const k = grid[r * GRID_W + c];
    if (k === 0) continue; // water cells inside a coastal polygon do not count
    counts[k]++; total++;
  }
  const mix: Record<string, number> = {};
  if (total) TERRAIN_CLASSES.forEach((t, k) => { if (counts[k]) mix[t] = Math.round((counts[k] / total) * 1000) / 1000; });
  return mix;
}

function readAll<T>(dir: string, bad: Set<string>): T[] {
  return listJson(dir).filter((f) => !bad.has(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')) as T);
}

/** public/data/mechanics.json content: one section per data/mechanics file. The version is a hash
 *  of that content: the build date changed a committed file on every rebuild of unchanged data. */
export function buildMechanics(bad: Set<string>): Record<string, unknown> {
  const mechanics: Record<string, unknown> = { version: '' };
  for (const f of listJson('mechanics')) {
    if (bad.has(f)) continue;
    const key = f.split('/').pop()!.replace('.json', '');
    mechanics[key] = JSON.parse(readFileSync(f, 'utf8'));
  }
  mechanics.version = createHash('sha256').update(JSON.stringify(mechanics)).digest('hex').slice(0, 12);
  return mechanics;
}

/** public/data/battles.json content. */
export function buildBattles(bad: Set<string>): unknown[] {
  return readAll('battles', bad);
}

/** Files that fail validation (skipped by the build). */
export function invalidFiles(): Set<string> {
  return new Set(validateAll().issues.filter((i) => i.level === 'error').map((i) => i.file));
}

async function main() {
  const { issues, counts } = validateAll();
  const bad = new Set(issues.filter((i) => i.level === 'error').map((i) => i.file));
  for (const f of bad) console.log(`SKIP ${f.replace(ROOT + '/', '')}: ${issues.filter((i) => i.file === f && i.level === 'error').map((i) => i.msg).join(' | ').slice(0, 300)}`);
  console.log('validated', counts, `${bad.size} files skipped`);
  mkdirSync(PUB, { recursive: true });

  const gridBin = readFileSync(join(PUB, 'terrain', 'grid.bin'));
  const grid = new Uint8Array(gridBin.buffer, gridBin.byteOffset, GRID_W * GRID_H);
  writeFileSync(join(PUB, 'terrain', 'grid.pack.gz'), gzipSync(packTerrain(gridBin), { level: 9 }));
  const zones = join(PUB, 'climate', 'zones.bin');
  if (existsSync(zones)) writeFileSync(zones + '.gz', gzipSync(readFileSync(zones), { level: 9 }));
  const snapshots = readAll<Snapshot>('raw/snapshots', bad).sort((a, b) => a.id.localeCompare(b.id));
  const borders: Record<string, MultiPolygon> = {};
  const prog = new Progress('borders', Math.max(1, snapshots.length));
  for (const s of snapshots) {
    const mp = s.territory.border === 'none' ? null : await resolveBorder(s.territory.border);
    if (mp && mp.length) {
      // simplification erases micro-states (Monaco, Nauru, Tuvalu, Vatican City, Maldives shipped
      // an empty polygon and the engine fell back to a disc): keep the full ring when it does
      const simple = simplifyMulti(mp, SIMPLIFY_DEG);
      borders[s.id] = simple.length ? simple : mp;
      s.geography.terrainMix = terrainMix(mp, grid);
      const area = multiAreaKm2(mp), claimed = s.territory.areaKm2.mid;
      if (claimed > 0 && Math.abs(Math.log(area / claimed)) > Math.log(2)) {
        console.log(`WARN ${s.id}: border polygon area ${Math.round(area).toLocaleString()} km2 vs researched ${Math.round(claimed).toLocaleString()} km2`);
      }
    } else if (s.territory.border !== 'none') {
      console.log(`WARN ${s.id}: border ${s.territory.border} not found`);
    }
    prog.tick();
  }

  const nations = new Map<string, Nation>();
  for (const s of snapshots) {
    const n = nations.get(s.nationId) ?? { id: s.nationId, name: s.name, aliases: [], region: s.region, snapshotIds: [] };
    n.snapshotIds.push(s.id);
    if (s.name !== n.name && !n.aliases.includes(s.name)) n.aliases.push(s.name);
    nations.set(s.nationId, n);
  }
  const nationList = [...nations.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const n of nationList) {
    n.snapshotIds.sort((a, b) => snapshots.find((s) => s.id === a)!.year - snapshots.find((s) => s.id === b)!.year);
  }

  const mechanics = buildMechanics(bad);

  const write = (name: string, v: unknown) => writeFileSync(join(PUB, name), JSON.stringify(v));
  // Phase 3 snapshots (tag phase3) are split per era so the first load stays small; the
  // index carries what search and browse need plus the confidence label.
  const isP3 = (s: Snapshot) => s.tags.includes('phase3');
  // The prose goes to its own file so the first screen does not wait for it (snapshotText.ts).
  const { core, text } = splitSnapshotText(snapshots.filter((s) => !isP3(s)));
  write('snapshots.json', core);
  write('snapshot-notes.json', text);
  const p3 = snapshots.filter(isP3);
  const eraFiles = new Set<string>();
  for (const era of ERAS) {
    const e = p3.filter((s) => s.era === era);
    if (!e.length) continue;
    eraFiles.add(`snapshots-phase3-${era}.json`);
    write(`snapshots-phase3-${era}.json`, e);
  }
  for (const f of readdirSync(PUB)) if (/^snapshots-phase3-(?!index).*\.json$/.test(f) && !eraFiles.has(f)) unlinkSync(join(PUB, f));
  const index: Phase3Entry[] = p3.map((s) => ({
    id: s.id, nationId: s.nationId, name: s.name, year: s.year, era: s.era, region: s.region, tags: s.tags,
    confidence: confidence(s).letter, population: s.demography.population.mid, active: s.military.activePersonnel.mid,
  }));
  write('snapshots-phase3-index.json', index);
  write('nations.json', nationList);
  writeFileSync(join(DATA, 'nations.json'), JSON.stringify(nationList, null, 1));
  write('borders.json', borders);
  write('doctrines.json', readAll('doctrine', bad));
  write('mechanics.json', mechanics);
  write('battles.json', buildBattles(bad));
  for (const name of ['coalitions.json', 'presets.json']) {
    const src = join(DATA, name);
    write(name, existsSync(src) && !bad.has(src) ? JSON.parse(readFileSync(src, 'utf8')) : []);
  }
  console.log(`built ${snapshots.length} snapshots (${p3.length} phase 3 in ${eraFiles.size} era files), ${nationList.length} nations, ${Object.keys(borders).length} borders, mechanics sections: ${Object.keys(mechanics).length - 1}`);
}

if (process.argv[1]?.endsWith('build.ts')) main().catch((e) => { console.error(e); process.exit(1); });
