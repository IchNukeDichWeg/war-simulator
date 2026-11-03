// Runtime data loader. Every file may be missing or empty while the pipeline is
// still running; the UI shows empty states instead of failing.
import type { Coalition, DoctrineProfile, EraId, Grade, Nation, RegionId, Snapshot } from '../types/schema';
import type { Mechanics } from '../types/mechanics';
import type { Scenario } from '../types/scenario';
import { CLIMATE_H, CLIMATE_W } from '../engine/climate';
import { TERRAIN_BYTES, gunzipBody, unpackTerrain } from './terrainPack';
import { mergeSnapshotText, type TextTree } from './snapshotText';

/** One line of public/data/snapshots-phase3-index.json: a Phase 3 derived snapshot that is
 *  searchable before its era file (snapshots-phase3-<era>.json) is loaded. */
export interface Phase3Entry {
  id: string;
  nationId: string;
  name: string;
  year: number;
  era: EraId;
  region: RegionId;
  tags: string[];
  /** Mean grade over every value of the snapshot (data-pipeline/validate.ts confidence()). */
  confidence: Grade;
  population: number;
  active: number;
}

export interface AppData {
  /** Loaded snapshots: researched and auto-base at start, Phase 3 eras as they are loaded. */
  snapshots: Snapshot[];
  /** Index of every Phase 3 derived snapshot, loaded or not. */
  phase3: Phase3Entry[];
  phase3ById: Map<string, Phase3Entry>;
  /** Phase 3 eras whose snapshot file is merged into `snapshots`. */
  phase3Loaded: EraId[];
  nations: Nation[];
  doctrines: DoctrineProfile[];
  mechanics: Mechanics | null;
  coalitions: Coalition[];
  presets: Scenario[];
  borders: Record<string, number[][][][]>;
  terrain: ArrayBuffer | null;
  /** Koppen-Geiger zone grid; without it the engine uses zone C weather odds everywhere. */
  climate: ArrayBuffer | null;
  /** Files that were missing, empty or unparsable. */
  missing: string[];
  /** True when synthetic dev fixtures were loaded (?fixtures=1). */
  fixtures: boolean;
  snapById: Map<string, Snapshot>;
  nationById: Map<string, Nation>;
}

const BASE = import.meta.env.BASE_URL + 'data/';

async function getJson<T>(file: string, missing: string[]): Promise<T | null> {
  try {
    const r = await fetch(BASE + file);
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) { missing.push(file); return null; }
    const v = await r.json();
    const empty = v == null || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && Object.keys(v).length === 0);
    if (empty) missing.push(file);
    return v as T;
  } catch {
    missing.push(file);
    return null;
  }
}

/** terrain/grid.pack.gz (src/ui/terrainPack.ts): 2.28 MB instead of 6.22 MB on the wire, and
 *  hosts do not gzip .bin files on the fly. Null when the browser lacks DecompressionStream or
 *  the file is missing or bad; getTerrain then falls back to the raw grid.bin. */
async function getPackedTerrain(): Promise<ArrayBuffer | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const r = await fetch(BASE + 'terrain/grid.pack.gz');
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) return null;
    const packed = await gunzipBody(await r.arrayBuffer());
    return packed.length === TERRAIN_BYTES ? unpackTerrain(packed) : null;
  } catch {
    return null;
  }
}

async function getTerrain(missing: string[]): Promise<ArrayBuffer | null> {
  const packed = await getPackedTerrain();
  if (packed) return packed;
  try {
    const r = await fetch(BASE + 'terrain/grid.bin');
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) { missing.push('terrain/grid.bin'); return null; }
    const b = await r.arrayBuffer();
    if (b.byteLength !== TERRAIN_BYTES) { missing.push('terrain/grid.bin'); return null; }
    return b;
  } catch {
    missing.push('terrain/grid.bin');
    return null;
  }
}

async function getClimate(missing: string[]): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(BASE + 'climate/zones.bin');
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) { missing.push('climate/zones.bin'); return null; }
    const b = await r.arrayBuffer();
    if (b.byteLength !== CLIMATE_W * CLIMATE_H) { missing.push('climate/zones.bin'); return null; }
    return b;
  } catch {
    missing.push('climate/zones.bin');
    return null;
  }
}

function isMechanics(m: unknown): m is Mechanics {
  return !!m && typeof m === 'object' && 'lethality' in (m as object) && 'combat' in (m as object);
}

let loading: Promise<AppData> | null = null;

/** Load the runtime data once per page. Memoized because React StrictMode runs App's effect
 *  twice in dev and both fetch sets were in flight at once, so the HTTP cache did not help:
 *  32.7 MB of data per dev page load instead of 16.3 MB (headless Chrome over CDP, cache off). */
export function loadData(): Promise<AppData> {
  loading ??= loadAll();
  return loading;
}

async function loadAll(): Promise<AppData> {
  const missing: string[] = [];
  // battles.json (110 kB) is not fetched: only the headless backtest reads the battle cases.
  const [snapshots, notes, phase3, nations, doctrines, mechanics, coalitions, presets, borders, terrain, climate] = await Promise.all([
    getJson<Snapshot[]>('snapshots.json', missing),
    getJson<Record<string, TextTree>>('snapshot-notes.json', missing),
    getJson<Phase3Entry[]>('snapshots-phase3-index.json', missing),
    getJson<Nation[]>('nations.json', missing),
    getJson<DoctrineProfile[]>('doctrines.json', missing),
    getJson<unknown>('mechanics.json', missing),
    getJson<Coalition[]>('coalitions.json', missing),
    getJson<Scenario[]>('presets.json', missing),
    getJson<Record<string, number[][][][]>>('borders.json', missing),
    getTerrain(missing),
    getClimate(missing),
  ]);
  const mech = isMechanics(mechanics) ? mechanics : null;
  if (!mech && !missing.includes('mechanics.json')) missing.push('mechanics.json');
  const d: AppData = {
    snapshots: Array.isArray(snapshots) ? mergeSnapshotText(snapshots, notes && typeof notes === 'object' ? notes : {}) : [],
    phase3: Array.isArray(phase3) ? phase3 : [],
    phase3ById: new Map(),
    phase3Loaded: [],
    nations: Array.isArray(nations) ? nations : [],
    doctrines: Array.isArray(doctrines) ? doctrines : [],
    mechanics: mech,
    coalitions: Array.isArray(coalitions) ? coalitions : [],
    presets: Array.isArray(presets) ? presets : [],
    borders: borders && typeof borders === 'object' ? borders : {},
    terrain,
    climate,
    missing,
    fixtures: false,
    snapById: new Map(),
    nationById: new Map(),
  };
  if (new URLSearchParams(location.search).has('fixtures') && d.snapshots.length === 0) {
    const { devFixtures } = await import('./devFixtures/fixtures');
    const f = devFixtures();
    Object.assign(d, f, { fixtures: true });
  }
  // nations.json may be empty while snapshots exist: derive a minimal index
  if (d.nations.length === 0 && d.snapshots.length > 0) {
    const m = new Map<string, Nation>();
    for (const s of d.snapshots) {
      const n = m.get(s.nationId) ?? { id: s.nationId, name: s.name, aliases: [], region: s.region, snapshotIds: [] };
      n.snapshotIds.push(s.id);
      m.set(s.nationId, n);
    }
    d.nations = [...m.values()];
  }
  d.snapshots.sort((a, b) => a.name.localeCompare(b.name) || a.year - b.year);
  d.snapById = new Map(d.snapshots.map((s) => [s.id, s]));
  d.nationById = new Map(d.nations.map((n) => [n.id, n]));
  d.phase3.sort((a, b) => a.name.localeCompare(b.name) || a.year - b.year);
  d.phase3ById = new Map(d.phase3.map((e) => [e.id, e]));
  return d;
}

/** Fetch one era of Phase 3 snapshots. Throws when the file is missing. */
export async function fetchPhase3Era(era: EraId): Promise<Snapshot[]> {
  const file = `snapshots-phase3-${era}.json`;
  const r = await fetch(BASE + file);
  const ct = r.headers.get('content-type') ?? '';
  if (!r.ok || ct.includes('text/html')) throw new Error(`${file} is missing`);
  const v = await r.json();
  if (!Array.isArray(v)) throw new Error(`${file} is not a snapshot list`);
  return v as Snapshot[];
}

/** A new AppData with an era's Phase 3 snapshots merged in (the store needs a new object). */
export function mergePhase3(d: AppData, era: EraId, snaps: Snapshot[]): AppData {
  if (d.phase3Loaded.includes(era)) return d;
  const add = snaps.filter((s) => !d.snapById.has(s.id));
  const snapshots = [...d.snapshots, ...add].sort((a, b) => a.name.localeCompare(b.name) || a.year - b.year);
  return { ...d, snapshots, snapById: new Map(snapshots.map((s) => [s.id, s])), phase3Loaded: [...d.phase3Loaded, era] };
}

/** Year of a snapshot id, loaded or only in the Phase 3 index. */
export function yearOf(d: AppData, id: string): number | undefined {
  return d.snapById.get(id)?.year ?? d.phase3ById.get(id)?.year;
}

export function yearLabel(y: number): string {
  return y < 0 ? `${-y} BCE` : `${y}`;
}
