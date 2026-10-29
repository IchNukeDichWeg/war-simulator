// Runtime data loader. Every file may be missing or empty while the pipeline is
// still running; the UI shows empty states instead of failing.
import type { Coalition, DoctrineProfile, Nation, Snapshot } from '../types/schema';
import type { Mechanics } from '../types/mechanics';
import type { Scenario } from '../types/scenario';
import { GRID_H, GRID_W } from '../engine/terrainClasses';

export interface AppData {
  snapshots: Snapshot[];
  nations: Nation[];
  doctrines: DoctrineProfile[];
  mechanics: Mechanics | null;
  coalitions: Coalition[];
  battles: unknown[];
  presets: Scenario[];
  borders: Record<string, number[][][][]>;
  terrain: ArrayBuffer | null;
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

async function getTerrain(missing: string[]): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(BASE + 'terrain/grid.bin');
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) { missing.push('terrain/grid.bin'); return null; }
    const b = await r.arrayBuffer();
    if (b.byteLength !== GRID_W * GRID_H * 6) { missing.push('terrain/grid.bin'); return null; }
    return b;
  } catch {
    missing.push('terrain/grid.bin');
    return null;
  }
}

function isMechanics(m: unknown): m is Mechanics {
  return !!m && typeof m === 'object' && 'lethality' in (m as object) && 'combat' in (m as object);
}

export async function loadData(): Promise<AppData> {
  const missing: string[] = [];
  const [snapshots, nations, doctrines, mechanics, coalitions, battles, presets, borders, terrain] = await Promise.all([
    getJson<Snapshot[]>('snapshots.json', missing),
    getJson<Nation[]>('nations.json', missing),
    getJson<DoctrineProfile[]>('doctrines.json', missing),
    getJson<unknown>('mechanics.json', missing),
    getJson<Coalition[]>('coalitions.json', missing),
    getJson<unknown[]>('battles.json', missing),
    getJson<Scenario[]>('presets.json', missing),
    getJson<Record<string, number[][][][]>>('borders.json', missing),
    getTerrain(missing),
  ]);
  const mech = isMechanics(mechanics) ? mechanics : null;
  if (!mech && !missing.includes('mechanics.json')) missing.push('mechanics.json');
  const d: AppData = {
    snapshots: Array.isArray(snapshots) ? snapshots : [],
    nations: Array.isArray(nations) ? nations : [],
    doctrines: Array.isArray(doctrines) ? doctrines : [],
    mechanics: mech,
    coalitions: Array.isArray(coalitions) ? coalitions : [],
    battles: Array.isArray(battles) ? battles : [],
    presets: Array.isArray(presets) ? presets : [],
    borders: borders && typeof borders === 'object' ? borders : {},
    terrain,
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
  return d;
}

export function yearLabel(y: number): string {
  return y < 0 ? `${-y} BCE` : `${y}`;
}
