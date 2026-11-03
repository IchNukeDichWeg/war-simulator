// What the snapshot detail view shows: the key numbers with their ranges and grades, the force
// mix, and every cited source with the fields that cite it. Pure, tested in
// tests/snapshotFacts.test.ts.
import type { Est, Snapshot, UnitRole } from '../types/schema';
import { ROLE_LABEL, ROLE_ORDER } from './roles';

export interface KeyRow { label: string; est: Est; unit?: 'pct' | 'km' | 'km2' | 'tech' }

const at = (s: Snapshot): [string, Est | undefined, KeyRow['unit']?][] => [
  ['Population', s.demography?.population],
  ['Territory', s.territory?.areaKm2, 'km2'],
  ['Active personnel', s.military?.activePersonnel],
  ['Trained reserves', s.military?.trainedReserves],
  ['Mobilizable', s.military?.mobilizable],
  ['GDP (2011 int$)', s.economy?.gdp],
  ['GDP per capita', s.economy?.gdpPerCapita],
  ['Military spending', s.economy?.milSpendShare, 'pct'],
  ['Supply range', s.logistics?.supplyRangeKm, 'km'],
  ['Weapons tech (0..10)', s.tech?.weapons, 'tech'],
  ['Nuclear warheads', s.strategic?.nuclearWarheads],
];

/** The numbers a reader checks first. Reserves and warheads are left out when zero (most
 *  pre-modern snapshots), everything else is always listed. */
export function keyNumbers(s: Snapshot): KeyRow[] {
  const out: KeyRow[] = [];
  for (const [label, est, unit] of at(s)) {
    if (!est) continue;
    if ((label === 'Nuclear warheads' || label === 'Trained reserves') && est.high === 0) continue;
    out.push({ label, est, unit });
  }
  return out;
}

/** Force entries with a non-zero count, in the engine's role order. */
export function forceMix(s: Snapshot): { role: UnitRole; label: string; count: Est }[] {
  const f = s.military?.forces ?? {};
  return ROLE_ORDER.filter((r) => (f[r]?.count.mid ?? 0) > 0).map((r) => ({ role: r, label: ROLE_LABEL[r], count: f[r]!.count }));
}

export type SourceKind = 'url' | 'doi' | 'isbn' | 'derived' | 'other';
export interface SourceRef {
  source: string;
  kind: SourceKind;
  /** Where a click goes; none for derivation methods (data/SOURCES.md documents them). */
  href?: string;
  label: string;
  /** How many values of the snapshot cite it. */
  count: number;
  /** Dot paths of those values, for the tooltip. */
  fields: string[];
}

export function sourceRef(source: string): Omit<SourceRef, 'count' | 'fields'> {
  if (/^https?:\/\//.test(source)) {
    let label = source;
    try {
      const u = new URL(source);
      const tail = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/_/g, ' ');
      label = u.hostname.replace(/^www\./, '') + (tail ? `: ${tail.slice(0, 60)}` : '');
    } catch { /* keep the raw string */ }
    return { source, kind: 'url', href: source, label };
  }
  if (source.startsWith('doi:')) return { source, kind: 'doi', href: `https://doi.org/${source.slice(4)}`, label: source };
  if (source.startsWith('isbn:')) {
    const isbn = source.slice(5).replace(/[^0-9Xx]/g, '');
    return { source, kind: 'isbn', href: `https://openlibrary.org/isbn/${isbn}`, label: source };
  }
  if (source.startsWith('derived:')) return { source, kind: 'derived', label: source.slice(8).replace(/-/g, ' ') };
  return { source, kind: 'other', label: source || 'no source' };
}

const isEst = (o: unknown): o is Est => !!o && typeof o === 'object' && 'mid' in o && 'grade' in o && 'source' in o;

/** Every distinct source a snapshot cites, cited works first (most-cited first), then the
 *  derivation methods. */
export function snapshotSources(s: Snapshot): SourceRef[] {
  const m = new Map<string, SourceRef>();
  const walk = (o: unknown, path: string) => {
    if (isEst(o)) {
      const r = m.get(o.source) ?? { ...sourceRef(o.source), count: 0, fields: [] };
      r.count++;
      r.fields.push(path);
      m.set(o.source, r);
      return;
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(s, '');
  const rank = (r: SourceRef) => (r.kind === 'derived' || r.kind === 'other' ? 1 : 0);
  return [...m.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.source.localeCompare(b.source));
}

/** Relative width of a value's range, (high - low) / mid; null when mid is zero. */
export function spread(e: Est): number | null {
  return e.mid > 0 ? (e.high - e.low) / e.mid : null;
}
