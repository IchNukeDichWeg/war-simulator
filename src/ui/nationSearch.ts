// Search and filter over every nation snapshot: the loaded ones (researched, auto-base and
// any Phase 3 era already fetched) and the Phase 3 index entries whose era file is not
// loaded yet. Pure functions over plain items, so the ranking is unit-tested
// (tests/nationSearch.test.ts) and shared by the Nations tab and the side pickers.
import type { EraId, Grade, Nation, RegionId, Snapshot } from '../types/schema';
import type { Phase3Entry } from './data';

export const ERA_LABEL: Record<EraId, string> = {
  bronze: 'Bronze Age', iron: 'Iron Age / Classical', medieval: 'Medieval', gunpowder: 'Gunpowder',
  industrial: 'Napoleonic / industrial', worldwars: 'World Wars', coldwar: 'Cold War', modern: 'Modern',
};
export const REGION_LABEL: Record<RegionId, string> = {
  europe: 'Europe', mena: 'Middle East / N. Africa', subsaharan_africa: 'Sub-Saharan Africa', central_asia: 'Central Asia',
  south_asia: 'South Asia', east_asia: 'East Asia', southeast_asia: 'Southeast Asia', north_america: 'North America',
  latin_america: 'Latin America', oceania: 'Oceania',
};

/** Where a snapshot's numbers come from. "researched": cited per value (data/RESEARCH_BRIEF.md);
 *  "auto": the 2026 auto-base snapshots, World Bank figures plus regional analogues;
 *  "derived": Phase 3, every value a formula over the border polygon and regional inputs. */
export type SnapKind = 'researched' | 'auto' | 'derived';
export const KIND_LABEL: Record<SnapKind, string> = { researched: 'Researched', auto: 'Auto-base', derived: 'Phase 3 derived' };
const KIND_RANK: Record<SnapKind, number> = { researched: 0, auto: 1, derived: 2 };
const GRADE_RANK: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1 };

export interface SearchItem {
  id: string;
  nationId: string;
  name: string;
  year: number;
  era: EraId;
  region: RegionId;
  tags: string[];
  aliases: string[];
  kind: SnapKind;
  /** Overall grade: the mean over every value (same rule as data-pipeline/validate.ts confidence()). */
  confidence: Grade;
  population: number;
  active: number;
  /** Grade of the active-personnel value; unknown until a Phase 3 era is loaded. */
  activeGrade?: Grade;
  loaded: boolean;
}

export interface SearchFilters {
  era?: EraId | '';
  region?: RegionId | '';
  kind?: SnapKind | '';
  /** Lowest overall grade shown: 'B' keeps A and B. */
  minGrade?: Grade | '';
}

export interface Ranked { item: SearchItem; score: number }

// ---- item construction ------------------------------------------------------------------

export function kindOf(s: { id: string; tags: string[] }, isPhase3: boolean): SnapKind {
  if (isPhase3 || s.tags.includes('phase3')) return 'derived';
  if (s.tags.includes('auto-base')) return 'auto';
  return 'researched';
}

const isEst = (o: unknown): o is { grade: Grade } =>
  !!o && typeof o === 'object' && 'mid' in o && 'low' in o && 'high' in o && 'grade' in o;

export interface Confidence { counts: Record<Grade, number>; n: number; score: number; letter: Grade }
const confCache = new WeakMap<Snapshot, Confidence>();

/** Mean grade over every value of a snapshot: A=4 .. D=1, letter cut at 3.5 / 2.5 / 1.75
 *  (data-pipeline/validate.ts confidence(), which writes the Phase 3 index grades). */
export function snapshotConfidence(s: Snapshot): Confidence {
  const hit = confCache.get(s);
  if (hit) return hit;
  const counts: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
  const walk = (o: unknown) => {
    if (isEst(o)) { if (o.grade in counts) counts[o.grade]++; return; }
    if (!o || typeof o !== 'object') return;
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
  };
  walk(s);
  const n = counts.A + counts.B + counts.C + counts.D;
  const score = (4 * counts.A + 3 * counts.B + 2 * counts.C + counts.D) / (n || 1);
  const letter: Grade = score >= 3.5 ? 'A' : score >= 2.5 ? 'B' : score >= 1.75 ? 'C' : 'D';
  const out = { counts, n, score, letter };
  confCache.set(s, out);
  return out;
}

export interface ItemSource {
  snapshots: Snapshot[];
  phase3: Phase3Entry[];
  phase3ById: Map<string, Phase3Entry>;
  snapById: Map<string, Snapshot>;
  nationById: Map<string, Nation>;
}

const itemCache = new WeakMap<object, SearchItem[]>();

/** One item per snapshot id: loaded snapshots first-hand, unloaded Phase 3 entries from the
 *  index. Cached per data object (the store replaces it when an era loads). */
export function buildItems(d: ItemSource): SearchItem[] {
  const hit = itemCache.get(d);
  if (hit) return hit;
  // the nation's own name counts as another name: "German Empire" for germany-1939
  const aliases = (nationId: string, name: string) => {
    const n = d.nationById.get(nationId);
    if (!n) return [];
    return [...new Set([n.name, ...n.aliases])].filter((a) => norm(a) !== norm(name));
  };
  const out: SearchItem[] = d.snapshots.map((s) => {
    const p3 = d.phase3ById.get(s.id);
    return {
      id: s.id, nationId: s.nationId, name: s.name, year: s.year, era: s.era, region: s.region, tags: s.tags,
      aliases: aliases(s.nationId, s.name), kind: kindOf(s, !!p3), confidence: p3?.confidence ?? snapshotConfidence(s).letter,
      population: s.demography.population.mid, active: s.military.activePersonnel.mid,
      activeGrade: s.military.activePersonnel.grade, loaded: true,
    };
  });
  for (const e of d.phase3) {
    if (d.snapById.has(e.id)) continue;
    out.push({
      id: e.id, nationId: e.nationId, name: e.name, year: e.year, era: e.era, region: e.region, tags: e.tags,
      aliases: aliases(e.nationId, e.name), kind: 'derived', confidence: e.confidence, population: e.population, active: e.active, loaded: false,
    });
  }
  out.sort(byName);
  itemCache.set(d, out);
  return out;
}

const byName = (a: SearchItem, b: SearchItem) => a.name.localeCompare(b.name) || a.year - b.year;

// ---- query parsing ----------------------------------------------------------------------

/** Lower case, accents dropped ("Kanem-Bornu" and "Kanem Bornu", "Sao Tome" and "Sao Tomé" meet). */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export interface ParsedQuery {
  text: string[];
  years: number[];
  /** Inclusive [from, to] year ranges ("1900-1950", "500bce..100bce"); a hard filter. */
  ranges: [number, number][];
}

const ERA_SUFFIX = /^(bce|bc|ce|ad)$/;
const YEAR = /^(-?\d{1,4})(bce|bc|ce|ad)?$/;
/** Filler words that would otherwise have to match: "kingdom of france" finds "France". */
const STOPWORDS = new Set(['of', 'the', 'and', 'in']);
const RANGE = /^(-?\d{1,4})(bce|bc|ce|ad)?(?:-|\.\.)(-?\d{1,4})(bce|bc|ce|ad)?$/;
const toYear = (n: string, suffix?: string) => {
  const v = parseInt(n, 10);
  return suffix === 'bce' || suffix === 'bc' ? -Math.abs(v) : v;
};

/** Split a query into text words and years. "480 bce", "480bce" and "-480" are 480 BCE; a
 *  bare number of one to four digits is a year CE. */
export function parseQuery(q: string): ParsedQuery {
  const raw = norm(q).split(/[\s,;]+/).filter(Boolean);
  const out: ParsedQuery = { text: [], years: [], ranges: [] };
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const next = raw[i + 1];
    const r = t.match(RANGE);
    if (r) {
      let a = toYear(r[1], r[2]), b = toYear(r[3], r[4] ?? (next && ERA_SUFFIX.test(next) ? next : undefined));
      if (r[4] === undefined && next && ERA_SUFFIX.test(next)) i++;
      // "500-100 bce": the suffix covers both ends
      if (r[2] === undefined && b < 0 && a > 0) a = -a;
      out.ranges.push([Math.min(a, b), Math.max(a, b)]);
      continue;
    }
    const m = t.match(YEAR);
    let suffix = m?.[2];
    if (m && !suffix && next && ERA_SUFFIX.test(next)) { suffix = next; i++; }
    // a lone digit is a word ("world war 2"), not the year 2 CE
    if (m && (suffix || m[1].replace('-', '').length >= 2)) {
      out.years.push(toYear(m[1], suffix));
      continue;
    }
    if (ERA_SUFFIX.test(t)) continue; // a stray "bce" with no number before it
    out.text.push(...words(t));
  }
  const kept = out.text.filter((w) => !STOPWORDS.has(w));
  if (kept.length) out.text = kept;
  return out;
}

// ---- matching ---------------------------------------------------------------------------

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early once
 *  past `max`. Inputs are single words, so the quadratic table stays tiny. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** How well one query word matches one field word, 0..1. Exact beats prefix beats
 *  substring beats a typo; a typo needs four letters so "us" never fuzzes into "uk". */
export function wordScore(tok: string, w: string): number {
  if (w === tok) return 1;
  if (w.startsWith(tok)) return tok.length >= 3 ? 0.85 : 0.7;
  if (tok.length >= 3 && w.includes(tok)) return 0.55;
  if (tok.length >= 4) {
    const max = tok.length >= 7 ? 2 : 1;
    if (editDistance(tok, w, max) <= max) return 0.5;
    // a typo in a word still being typed: "otomn" against "ottoman"; five letters, or "nato"
    // would find "napoleonic"
    if (tok.length >= 5 && w.length > tok.length && editDistance(tok, w.slice(0, tok.length), 1) <= 1) return 0.4;
  }
  return 0;
}

interface Field { words: string[]; initials: string; weight: number }
/** `wholes`: the name, the other names and the nation id as whole phrases, plus their
 *  initials, for the bonus when the query IS one of them. */
interface Prepared { item: SearchItem; fields: Field[]; wholes: string[] }

/** Field weights: a hit in the snapshot's own name counts most, then the nation's other names
 *  and id (researched snapshots carry descriptive names, "French Republic", so "france" has to
 *  find them through these), then tags, then where and when. Tuned by hand on the shipped data
 *  with queries like "rome", "france 1940", "ussr", "uk", "persia 480 bce", "hre". */
const W = { name: 3, alias: 2.5, tag: 1.5, place: 1.2 };
/** Query equal to a whole name, other name, nation id or their initials. */
const WHOLE_BONUS = 3;
/** Name or other name starting with the query. */
const PREFIX_BONUS = 1.5;
/** Most a year adds, at distance 0; half of it at 50 years off. Larger than WHOLE_BONUS so
 *  "persia 480 bce" puts the Achaemenid snapshot above a derived "Persia" of 400 CE. */
const YEAR_BONUS = 4;
/** Small lead for cited data over the formula-derived snapshots on a near tie: "rome" finds
 *  the researched Roman Empire before the derived polity named "Rome". */
const KIND_BONUS: Record<SnapKind, number> = { researched: 0.6, auto: 0.3, derived: 0 };

const prepCache = new WeakMap<SearchItem, Prepared>();
function prepare(item: SearchItem): Prepared {
  const hit = prepCache.get(item);
  if (hit) return hit;
  const f = (s: string, weight: number): Field => {
    const ws = words(s);
    return { words: ws, initials: ws.length > 1 ? ws.map((x) => x[0]).join('') : '', weight };
  };
  const names = [f(item.name, W.name), ...item.aliases.map((a) => f(a, W.alias)), f(item.nationId, W.alias)];
  const wholes = new Set<string>();
  for (const n of names) { wholes.add(n.words.join(' ')); if (n.initials.length >= 2) wholes.add(n.initials); }
  const p: Prepared = {
    item,
    wholes: [...wholes],
    fields: [
      ...names,
      ...item.tags.map((t) => f(t, W.tag)),
      f(`${REGION_LABEL[item.region] ?? ''} ${item.region}`, W.place),
      f(`${ERA_LABEL[item.era] ?? ''} ${item.era}`, W.place),
    ],
  };
  prepCache.set(item, p);
  return p;
}

function tokenScore(tok: string, p: Prepared): number {
  let best = 0;
  for (const fl of p.fields) {
    let s = 0;
    for (const w of fl.words) { const v = wordScore(tok, w); if (v > s) s = v; if (s === 1) break; }
    // initials: "hre" for Holy Roman Empire, "plc" for Polish-Lithuanian Commonwealth
    if (tok.length >= 2 && fl.initials === tok) s = Math.max(s, 0.9);
    const v = s * fl.weight;
    if (v > best) best = v;
  }
  return best;
}

/** Years within this distance of a year-only query are shown, nearest first. Phase 3
 *  snapshots sit on the historical-basemaps years (1938, 1945, 1960 ...), so 30 years catches
 *  the nearest map either side without listing a whole century. */
export const YEAR_WINDOW = 30;

function yearBonus(year: number, years: number[]): number {
  let b = 0;
  // "france 1940" puts France 1939 above France 1871
  for (const y of years) b = Math.max(b, YEAR_BONUS / (1 + Math.abs(year - y) / 50));
  return b;
}

export function passesFilters(it: SearchItem, f: SearchFilters): boolean {
  if (f.era && it.era !== f.era) return false;
  if (f.region && it.region !== f.region) return false;
  if (f.kind && it.kind !== f.kind) return false;
  if (f.minGrade && GRADE_RANK[it.confidence] < GRADE_RANK[f.minGrade]) return false;
  return true;
}

/** Items matching the query and filters, best first. Every text word must match some field
 *  (AND), with typos tolerated; years rank by closeness and filter only when the query has
 *  no words; ranges always filter. An empty query lists everything by name and year. */
export function searchSnapshots(items: SearchItem[], query: string, filters: SearchFilters = {}): Ranked[] {
  const q = parseQuery(query);
  const pool = items.filter((it) => passesFilters(it, filters)
    && q.ranges.every(([a, b]) => it.year >= a && it.year <= b));
  if (q.text.length === 0 && q.years.length === 0) return pool.sort(byName).map((item) => ({ item, score: 0 }));
  const full = q.text.join(' ');
  const out: Ranked[] = [];
  for (const item of pool) {
    let score = 0;
    if (q.text.length) {
      const p = prepare(item);
      let ok = true;
      for (const tok of q.text) {
        const s = tokenScore(tok, p);
        if (s <= 0) { ok = false; break; }
        score += s;
      }
      if (!ok) continue;
      if (p.wholes.includes(full)) score += WHOLE_BONUS;
      else if (p.wholes.some((w) => w.startsWith(full))) score += PREFIX_BONUS;
    } else if (!q.years.some((y) => Math.abs(item.year - y) <= YEAR_WINDOW)) continue;
    if (q.years.length) score += yearBonus(item.year, q.years);
    score += KIND_BONUS[item.kind];
    out.push({ item, score });
  }
  return out.sort((a, b) => b.score - a.score
    || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind]
    || GRADE_RANK[b.item.confidence] - GRADE_RANK[a.item.confidence]
    || byName(a.item, b.item));
}

/** How many items of each kind match the query and the other filters (the kind filter's counts). */
export function kindCounts(items: SearchItem[], query: string, filters: SearchFilters): Record<SnapKind, number> {
  const c: Record<SnapKind, number> = { researched: 0, auto: 0, derived: 0 };
  for (const r of searchSnapshots(items, query, { ...filters, kind: '' })) c[r.item.kind]++;
  return c;
}
