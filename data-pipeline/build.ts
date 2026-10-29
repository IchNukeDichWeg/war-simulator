// Builds the runtime data from validated research output.
//   data/raw/snapshots/*.json -> public/data/snapshots.json, data/nations.json, public/data/nations.json
//   border refs              -> public/data/borders.json (simplified MultiPolygons) + terrainMix
//   data/doctrine/*.json     -> public/data/doctrines.json
//   data/mechanics/*.json    -> public/data/mechanics.json
//   data/battles/*.json      -> public/data/battles.json
//   data/coalitions.json, data/presets.json -> public/data/
// Files that fail validation are skipped with a message, so one bad research
// file never breaks the app. Usage: tsx data-pipeline/build.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Nation, Snapshot } from '../src/types/schema';
import { GRID_H, GRID_RES, GRID_W, TERRAIN_CLASSES } from '../src/engine/terrainClasses';
import { ROOT, Progress, cachedFetch } from './lib/util';
import { MultiPolygon, bboxOf, multiAreaKm2, pointInMulti, simplifyMulti, toMulti } from './lib/geo';
import { listJson, validateAll } from './validate';

const DATA = join(ROOT, 'data');
const PUB = join(ROOT, 'public', 'data');
const HB = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';
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

async function main() {
  const { issues, counts } = validateAll();
  const bad = new Set(issues.filter((i) => i.level === 'error').map((i) => i.file));
  for (const f of bad) console.log(`SKIP ${f.replace(ROOT + '/', '')}: ${issues.filter((i) => i.file === f && i.level === 'error').map((i) => i.msg).join(' | ').slice(0, 300)}`);
  console.log('validated', counts, `${bad.size} files skipped`);
  mkdirSync(PUB, { recursive: true });

  const grid = new Uint8Array(readFileSync(join(PUB, 'terrain', 'grid.bin')).buffer, 0, GRID_W * GRID_H);
  const snapshots = readAll<Snapshot>('raw/snapshots', bad).sort((a, b) => a.id.localeCompare(b.id));
  const borders: Record<string, MultiPolygon> = {};
  const prog = new Progress('borders', Math.max(1, snapshots.length));
  for (const s of snapshots) {
    const mp = s.territory.border === 'none' ? null : await resolveBorder(s.territory.border);
    if (mp && mp.length) {
      borders[s.id] = simplifyMulti(mp, SIMPLIFY_DEG);
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

  const mechanics: Record<string, unknown> = { version: new Date().toISOString().slice(0, 10) };
  for (const f of listJson('mechanics')) {
    if (bad.has(f)) continue;
    const key = f.split('/').pop()!.replace('.json', '');
    mechanics[key] = JSON.parse(readFileSync(f, 'utf8'));
  }

  const write = (name: string, v: unknown) => writeFileSync(join(PUB, name), JSON.stringify(v));
  write('snapshots.json', snapshots);
  write('nations.json', nationList);
  writeFileSync(join(DATA, 'nations.json'), JSON.stringify(nationList, null, 1));
  write('borders.json', borders);
  write('doctrines.json', readAll('doctrine', bad));
  write('mechanics.json', mechanics);
  write('battles.json', readAll('battles', bad));
  for (const name of ['coalitions.json', 'presets.json']) {
    const src = join(DATA, name);
    write(name, existsSync(src) && !bad.has(src) ? JSON.parse(readFileSync(src, 'utf8')) : []);
  }
  console.log(`built ${snapshots.length} snapshots, ${nationList.length} nations, ${Object.keys(borders).length} borders, mechanics sections: ${Object.keys(mechanics).length - 1}`);
}

if (process.argv[1]?.endsWith('build.ts')) main().catch((e) => { console.error(e); process.exit(1); });
