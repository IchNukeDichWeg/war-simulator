import { DEFAULT_RULES, DEFAULT_VICTORY, type Scenario, type SideSpec, type TechMode } from '../types/scenario';
import type { Override } from '../types/schema';
import { overridePathProblem, overrideValueProblem } from '../engine/overridePath';

export type BBox = [number, number, number, number];

/** Theater presets [west, south, east, north]. Pacific stops at 180 E because the
 *  scenario bbox is not antimeridian-aware; Hawaii/Midway lie outside it. */
export const THEATERS: { name: string; bbox: BBox }[] = [
  { name: 'Europe', bbox: [-12, 34, 45, 62] },
  { name: 'Mediterranean', bbox: [-8, 29, 38, 47] },
  { name: 'Middle East', bbox: [25, 12, 63, 42] },
  { name: 'East Asia', bbox: [95, 15, 150, 52] },
  { name: 'Pacific', bbox: [100, -35, 180, 50] },
  { name: 'North America', bbox: [-130, 15, -55, 60] },
  { name: 'World', bbox: [-180, -60, 180, 75] },
];

export const SIDE_COLORS: [string, string] = ['#e5534b', '#4c8ed9'];

export function defaultScenario(): Scenario {
  return {
    version: 1,
    id: 'custom-' + Math.floor(Math.random() * 1e9).toString(36),
    name: 'Custom scenario',
    description: '',
    sides: [
      { name: 'Side A', color: SIDE_COLORS[0], members: [] },
      { name: 'Side B', color: SIDE_COLORS[1], members: [] },
    ],
    excluded: [],
    techMode: 'native',
    equalizedTech: 8,
    theater: { name: THEATERS[0].name, bbox: [...THEATERS[0].bbox] as BBox },
    startMonth: 5,
    rules: { ...DEFAULT_RULES },
    victory: { ...DEFAULT_VICTORY },
    seed: 1,
    overrides: [],
  };
}

/** Longest text a loaded scenario may carry, per field. The presets reach 60 (name),
 *  153 (description) and 17 (side name) characters and snapshot ids 44, so these leave
 *  ample room while a link can no longer put megabytes into a rendered label (red team C5). */
export const MAX_TEXT = { name: 200, description: 2000, sideName: 100, color: 32, id: 100 } as const;

function checkLength(v: unknown, max: number, field: string): void {
  if (typeof v === 'string' && v.length > max) throw new Error(`${field} is ${v.length.toLocaleString('en-US')} characters long; at most ${max} are allowed`);
}

/** Refuse over-long strings before anything renders or copies them. */
function checkStrings(o: Partial<Scenario>): void {
  checkLength(o.id, MAX_TEXT.id, 'id');
  checkLength(o.name, MAX_TEXT.name, 'name');
  checkLength(o.description, MAX_TEXT.description, 'description');
  checkLength(o.theater?.name, MAX_TEXT.sideName, 'theater.name');
  o.sides?.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    checkLength(s.name, MAX_TEXT.sideName, `sides[${i}].name`);
    checkLength(s.color, MAX_TEXT.color, `sides[${i}].color`);
    if (Array.isArray(s.members)) s.members.forEach((m, k) => checkLength(m, MAX_TEXT.id, `sides[${i}].members[${k}]`));
  });
  if (Array.isArray(o.excluded)) o.excluded.forEach((m, k) => checkLength(m, MAX_TEXT.id, `excluded[${k}]`));
  if (Array.isArray(o.overrides)) o.overrides.forEach((v, k) => { checkLength(v?.snapshotId, MAX_TEXT.id, `overrides[${k}].snapshotId`); checkLength(v?.path, MAX_TEXT.id, `overrides[${k}].path`); });
}

// ---- type checks for loaded scenarios -----------------------------------------------------
// Share links and files are untrusted. A wrong type used to pass straight to the engine and
// change the run (rules.nuclear "false" is truthy, so nuclear was ON) or crash it
// (equalizedTech "abc"); see red team W1. Policy: a missing field takes its default (older
// files lack newer fields), a field of the wrong type refuses the whole scenario with an
// error naming it, and a number of the right type is clamped to its range like the UI controls.

const TECH_MODES: readonly TechMode[] = ['native', 'equalized', 'timeslice'];
/** The time-limit input allows 1..36500 days (ScenarioBuilder); a link used to carry any number. */
export const MAX_TIME_LIMIT_DAYS = 36500;

const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : String(v));
function bad(field: string, want: string, v: unknown): never {
  throw new Error(`${field} must be ${want}, not ${show(v)}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function bool(v: unknown, field: string, def: boolean): boolean {
  if (v === undefined) return def;
  return typeof v === 'boolean' ? v : bad(field, 'true or false', v);
}
function num(v: unknown, field: string, def: number, min: number, max: number, integer = false): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field, 'a number', v);
  const c = Math.min(max, Math.max(min, v));
  return integer ? Math.round(c) : c;
}
function str(v: unknown, field: string, def: string): string {
  if (v === undefined) return def;
  return typeof v === 'string' ? v : bad(field, 'text', v);
}
function strList(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) bad(field, 'a list', v);
  return v.map((x, i) => (typeof x === 'string' ? x : bad(`${field}[${i}]`, 'text', x)));
}
function obj(v: unknown, field: string): Record<string, unknown> {
  if (v === undefined) return {};
  return isObj(v) ? v : bad(field, 'an object', v);
}

function side(v: unknown, i: number, d: SideSpec): SideSpec {
  const f = `sides[${i}]`;
  if (!isObj(v)) bad(f, 'an object', v);
  const out: SideSpec = { name: str(v.name, `${f}.name`, d.name), color: str(v.color, `${f}.color`, d.color), members: strList(v.members, `${f}.members`) };
  if (v.commitment !== undefined) {
    // share of a member's forces sent to this theater, 0..1 (the engine clamps the same way)
    out.commitment = Object.fromEntries(Object.entries(obj(v.commitment, `${f}.commitment`)).map(([k, x]) => [k, num(x, `${f}.commitment.${k}`, 1, 0, 1)]));
  }
  if (v.startPositions !== undefined) {
    if (!Array.isArray(v.startPositions)) bad(`${f}.startPositions`, 'a list', v.startPositions);
    out.startPositions = v.startPositions.map((p, k) => {
      const pf = `${f}.startPositions[${k}]`;
      if (!isObj(p)) bad(pf, 'an object', p);
      if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90) bad(`${pf}.lat`, 'a latitude', p.lat);
      if (typeof p.lon !== 'number' || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180) bad(`${pf}.lon`, 'a longitude', p.lon);
      return { lat: p.lat, lon: p.lon };
    });
  }
  return out;
}

/** Refuse a link or file whose override would write outside the editable fields
 *  (red team C1: "__proto__.x" polluted the engine worker) or a value no field can hold
 *  (C2/C3: negative or absurd counts). The engine refuses both too. */
function overrides(v: unknown): Override[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) bad('overrides', 'a list', v);
  const out = v.map((x, i): Override => {
    const f = `overrides[${i}]`;
    if (!isObj(x)) bad(f, 'an object', x);
    const snapshotId = typeof x.snapshotId === 'string' ? x.snapshotId : bad(`${f}.snapshotId`, 'a snapshot id', x.snapshotId);
    const pathProblem = overridePathProblem(x.path);
    if (pathProblem) throw new Error(`${f}.path: ${pathProblem}`);
    const valueProblem = overrideValueProblem(x.path as string, x.value);
    if (valueProblem) throw new Error(`${f}.value: ${valueProblem}`);
    return { snapshotId, path: x.path as string, value: x.value as number };
  });
  // One edit per field, the last one as the engine applies them in order: duplicates gave the
  // Editor's change list two rows with one React key.
  const key = (o: Override) => `${o.snapshotId} ${o.path}`;
  const last = new Map(out.map((o, i) => [key(o), i]));
  return out.filter((o, i) => last.get(key(o)) === i);
}

/** Check an uploaded / decoded scenario field by field, fill missing fields with defaults
 *  and refuse the unusable with an error that names the field. Only known fields are
 *  copied, so nothing else in the input reaches the store or the engine. */
export function normalizeScenario(x: unknown): Scenario {
  if (!isObj(x)) throw new Error('not a scenario object');
  const o = x as Partial<Scenario> & Record<string, unknown>;
  if (!Array.isArray(o.sides) || o.sides.length !== 2) throw new Error('scenario needs exactly two sides');
  checkStrings(o);
  const d = defaultScenario();
  const techMode = o.techMode === undefined ? d.techMode : TECH_MODES.includes(o.techMode) ? o.techMode : bad('techMode', TECH_MODES.join(', '), o.techMode);
  let theater = d.theater;
  if (o.theater !== undefined) {
    const t = obj(o.theater, 'theater');
    const bbox = t.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === 'number' && Number.isFinite(v))) bad('theater.bbox', 'four numbers [west, south, east, north]', bbox);
    // A latitude beyond a pole loaded fine and then threw "Invalid LngLat latitude" in the map's
    // fit. Longitude is left free: the Pacific preset runs to east = 210 across the antimeridian.
    const [, south, , north] = bbox as number[];
    if (!(south >= -90 && south < north && north <= 90)) throw new Error(`theater.bbox must have -90 <= south < north <= 90, not south ${south}, north ${north}`);
    theater = { name: str(t.name, 'theater.name', 'Custom'), bbox: [...bbox] as BBox };
  }
  const r = obj(o.rules, 'rules');
  const v = obj(o.victory, 'victory');
  const out: Scenario = {
    version: 1,
    id: str(o.id, 'id', d.id),
    name: str(o.name, 'name', d.name),
    description: str(o.description, 'description', d.description),
    sides: [side(o.sides[0], 0, d.sides[0]), side(o.sides[1], 1, d.sides[1])],
    excluded: strList(o.excluded, 'excluded'),
    techMode,
    theater,
    startMonth: num(o.startMonth, 'startMonth', d.startMonth, 1, 12, true),
    rules: {
      naval: bool(r.naval, 'rules.naval', d.rules.naval),
      air: bool(r.air, 'rules.air', d.rules.air),
      weather: bool(r.weather, 'rules.weather', d.rules.weather),
      supply: bool(r.supply, 'rules.supply', d.rules.supply),
      fogOfWar: bool(r.fogOfWar, 'rules.fogOfWar', d.rules.fogOfWar),
      nuclear: bool(r.nuclear, 'rules.nuclear', d.rules.nuclear),
    },
    victory: {
      capitalCaptured: bool(v.capitalCaptured, 'victory.capitalCaptured', d.victory.capitalCaptured),
      territoryShare: num(v.territoryShare, 'victory.territoryShare', d.victory.territoryShare, 0, 1),
      armyCollapse: bool(v.armyCollapse, 'victory.armyCollapse', d.victory.armyCollapse),
      timeLimitDays: num(v.timeLimitDays, 'victory.timeLimitDays', d.victory.timeLimitDays, 1, MAX_TIME_LIMIT_DAYS, true),
    },
    seed: num(o.seed, 'seed', 1, -Infinity, Infinity),
    overrides: overrides(o.overrides),
  };
  // tech level both sides fight at in equalized mode; the slider spans 0..10
  out.equalizedTech = num(o.equalizedTech, 'equalizedTech', d.equalizedTech ?? 8, 0, 10);
  return out;
}
