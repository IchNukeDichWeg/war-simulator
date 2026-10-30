// Scenario setup (ENGINE.md section 2): expand sides, apply overrides and tech
// mode, cut the theater grid, rasterise borders, work out commitment and power
// projection, and split forces into formations. Pure and deterministic (no RNG),
// so Monte Carlo builds it once and reuses it for every seed.
import type { EngineData, TheaterInfo } from './protocol';
import type { Scenario } from '../types/scenario';
import type { DoctrineProfile, Snapshot, TechCategory, UnitRole } from '../types/schema';
import type { ClimateZone, Mechanics, MobilityClass, MV, NavalPropulsion, Season, Weather } from '../types/mechanics';
import { GRID_H, GRID_RES, GRID_W, FLAG_COAST, T, cellIndex, cellCenter } from './terrainClasses';
import { buildGrid, cellAt, globalTerrain, haversineKm, inBbox, nearestLand, rasterizeMultiPolygon, type GlobalTerrain, type Grid } from './grid';
import { byTech, clamp, factor, rule, ruleMV, techFromYear, validateMechanics, yearFromTech } from './mech';
import { IS_AIR, IS_LAND, IS_NAVAL, IS_P, NR, RI, ROLES } from './roles';
import {
  ATTRITION_FROM_MODEL_RULES, ISLAND_CELL_LIMIT, MAX_FORMATIONS_PER_MEMBER, MAX_URBAN_SOURCES_PER_MEMBER, MISSION_COMMAND_DELAY_FACTOR,
  RETURN_RING_DAYS, RETURN_TO_DUTY_DAYS, RULES_FROM_MODEL_RULES, BATTLE_NOISE_SIGMA, COLLAPSE_PERSONNEL_FRACTION, COLLAPSE_MORALE,
  FOG_STRENGTH_ERROR, BLOCKADE_SEA_CONTROL, RIVER_DELAY_DAYS, BREAKPOINT_FROM_MODEL_RULES,
  REGIONAL_WEATHER, SYMMETRIC_DOCTRINE_BREAKPOINT, WITHDRAW_SHARE_OF_BREAKPOINT,
} from './constants';
import { CLIMATE_FALLBACK, CLIMATE_H, CLIMATE_W, theaterZone } from './climate';

export const TECH_CATS: TechCategory[] = ['weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber'];
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const WEATHERS = ['clear', 'rain', 'mud', 'snow'] as const;

type Start = { lat: number; lon: number; share: number };

/** Extra inputs used by backtests (BattleCase) on top of a Scenario. */
export interface SimOptions {
  /** 'battle': a single engagement, ends when one side breaks; no production. */
  mode?: 'war' | 'battle';
  /** Terrain class index forced on every land cell (battle cases give one terrain). */
  terrainOverride?: number;
  /** Start positions with shares per side (overrides SideSpec.startPositions). */
  starts?: [Start[] | undefined, Start[] | undefined];
  postures?: ['attack' | 'defend', 'attack' | 'defend'];
  fortified?: [boolean, boolean];
  /** Battle mode: the attacker crosses a river to attack (BattleCase.riverCrossing). */
  riverCrossing?: boolean;
  /** Battle mode: defender in a prepared defence (BattleSide.prepared). */
  prepared?: [boolean, boolean];
  /** Fixed quantile of every member's breakpoint range (0 low, 0.5 mid, 1 high) instead of the
   *  per-seed draw: 0.5 is the deterministic mode. */
  breakpointQuantile?: number;
  /** Fixed quantile of the AI force ratios (modelRules.aiForceRatio) instead of the per-seed draw. */
  ratioQuantile?: number;
  /** The case marks the side prepared:false (caught unentrenched): no field_fortification. */
  unprepared?: [boolean, boolean];
  surprise?: [boolean, boolean];
  reinforcements?: [{ day: number; counts: Partial<Record<UnitRole, number>> }[], { day: number; counts: Partial<Record<UnitRole, number>> }[]];
  objectives?: [CaseObjective | null, CaseObjective | null];
  /** Capitals of synthesized backtest sides are ordinary places, not fortresses. */
  unfortifiedCapitals?: boolean;
  /** Backtest cases: each side's 'capital' is its synthesized start base, not a real capital. */
  syntheticCapitals?: boolean;
  noProduction?: boolean;
  /** Initial control by nearest start position instead of border polygons. */
  voronoiControl?: boolean;
}

export interface CaseObjective { name: string; lat: number; lon: number; kind?: 'capture' | 'hold' | 'destroy'; radiusKm?: number }

export interface PlaceRT {
  name: string;
  cell: number;
  member: number;
  side: 0 | 1;
  kind: string;
  pop: number;
  fortified: boolean;
  /** A battle case's field position (trenches, minefields), not a walled place. */
  fieldWorks?: boolean;
  capital: boolean;
  port: boolean;
}

export interface MemberRT {
  idx: number;
  side: 0 | 1;
  snapId: string;
  nationId: string;
  name: string;
  snap: Snapshot;
  /** Year that selects per-era model rules: the snapshot year, or the year of the equalized tech level. */
  ruleYear: number;
  /** Hospital admissions: share lost (deaths, discharges) and days until the rest return. */
  admitLossShare: number; returnDays: number;
  /** Sea lift needed: GRT per soldier (with kit) and per platform of each role (land vehicles only). */
  seaTonsPerSoldier: number; seaTonsPerRole: Float64Array;
  /** Extra days to cross a major river cell without a bridge (era of the member). */
  riverDelayDays: number;
  doctrine: DoctrineProfile;
  w: DoctrineProfile['weights'];
  specials: Set<string>;
  tech: Record<TechCategory, number>;
  commitment: number;
  tli: Float64Array; qF: Float64Array; tF: Float64Array; range: Float64Array; rate: Float64Array;
  /** Range at the integer tech level reached (opening-round class, RANGE_INTEGER_CLASS). */
  rangeClass: Float64Array;
  mob: MobilityClass[]; mounted: Uint8Array; vehicle: Uint8Array;
  dispersion: number;
  commandF: number; homeDefense: number; morale0: number; cohesion: number;
  /** Breakpoint mid (cohesion-shifted) and withdraw threshold at it; the per-seed values are in
   *  MemberState (BREAKPOINT_FROM_MODEL_RULES draws within bpMV per seed). */
  breakpoint: number; retreat: number;
  bpMV: MV; bpShift: number; retreatThreshold: number;
  baseCas: number; alpha: number; pursuit: number; capture: number; fortF: number;
  supplyRangeKm: number; carriedDays: number; forageDep: number; animalsPer1000: number;
  ammoPer1000: number; supplyPer1000: number;
  disease: number; desertion: number; orderDelay: number; formationSize: number;
  mobilizationDays: number; trainingDays: number;
  roadThroughput: number; railThroughput: number; portThroughput: number;
  capitalCell: number;
  /** The capital is a real one (not a backtest case's synthesized start base). */
  capitalReal: boolean;
  entryCell: number; entryBySea: boolean; entryCostKm: number; oneWayDays: number;
  /** Sea lift: troops per trip and round-trip days (0 when not overseas). */
  lift: number; roundTripDays: number;
  seaDependent: boolean;
  spawnCells: number[];
  pMix: Float64Array;
  productionPerDay: Float64Array;
  reserves: number;
  recruitsPerBatchDay: number;   // recruits per day of induction (before mobilizable cap)
  mobilizable0: number;
  startCells: number;
  propulsion: NavalPropulsion;
}

export interface SourceList {
  cell: Int32Array;
  member: Int16Array;
  sea: Uint8Array;          // 1 = capacity scales with own sea control
  cost: Float32Array;       // initial path cost (km) at the source
  cap: Float64Array;        // tons/day
  place: Int16Array;        // place index, -1 entry/start point, -2 urban cell of own starting territory
}

export interface FormationSeed {
  member: number;
  cell: number;
  counts: Float64Array;
  arriveDay: number;
}

export interface Setup {
  data: EngineData;
  scenario: Scenario;
  m: Mechanics;
  opts: SimOptions;
  battleMode: boolean;
  grid: Grid;
  members: MemberRT[];
  sideMembers: [number[], number[]];
  sideNames: [string, string];
  lead: [number, number];
  friction: [number, number];        // order cycle / delay multiplier from coalition size
  places: PlaceRT[];
  placeAt: Int32Array;               // cell -> place index or -1
  control0: Uint8Array;
  owner0: Int16Array;
  startCells: [number, number];
  seeds: FormationSeed[];
  fleet0: [Float64Array, Float64Array];
  air0: [Float64Array, Float64Array];
  /** Model thresholds in force (sourced model rules, or the old constants with RULES_FROM_MODEL_RULES OFF). */
  rules: { noiseSigma: number; collapsePersonnel: number; collapseMorale: number; fogError: number; blockade: number };
  poolTech: [{ ships: number; air: number; weapons: number; q: Float64Array; t: Float64Array; cmd: number; propulsion: NavalPropulsion }, { ships: number; air: number; weapons: number; q: Float64Array; t: Float64Array; cmd: number; propulsion: NavalPropulsion }];
  sources: [SourceList, SourceList];
  objectiveCells: [number, number];
  /** Explicit objective kind per side, or undefined (inferred from initial control). */
  objectiveKinds: [CaseObjective['kind'], CaseObjective['kind']];
  /** 'destroy' objectives: radius around the objective point (km), else 0. */
  objectiveRadiusKm: [number, number];
  /** Terrain index -> movement multiplier (mid), combat factors, forage yield. */
  terrMove: Float64Array; terrAttack: Float64Array; terrMounted: Float64Array; forageYield: Float64Array;
  maxTerrMove: number;
  H: number;
  southern: boolean;
  /** Climate zone whose weather odds the theater uses (REGIONAL_WEATHER), or null with the toggle OFF. */
  climateZone: ClimateZone | null;
  /** Weather odds by local season in force (mids), indexed like movement.weatherOdds. */
  weatherOdds: Record<Season, Record<Weather, number>>;
  warnings: string[];
  theater: TheaterInfo;
  specialEffect: (key: string) => number;
  refRate: [number, number];        // median formation rate per side (km/day), for river penalty in fields
}

const est = (x: number, note = 'engine default') => ({ low: x, mid: x, high: x, grade: 'D' as const, source: 'derived:engine-default', note });

function setPath(obj: any, path: string, value: number): boolean {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') {
      if (keys[i - 1] === 'forces') o[keys[i]] = { count: est(0), quality: est(0.5), training: est(0.5) };
      else o[keys[i]] = {};
    }
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (typeof o !== 'object') return false;
  o[last] = value;
  return true;
}

function scaleSnapshot(s: Snapshot, f: number): void {
  const sc = (e: { low: number; mid: number; high: number } | undefined) => { if (e) { e.low *= f; e.mid *= f; e.high *= f; } };
  for (const r of Object.keys(s.military.forces) as UnitRole[]) sc(s.military.forces[r]?.count);
  sc(s.military.activePersonnel); sc(s.military.trainedReserves); sc(s.military.supportPersonnel); sc(s.military.mobilizable);
  sc(s.demography.population); sc(s.economy.gdp); sc(s.economy.annualCohort);
  for (const r of Object.keys(s.economy.production) as UnitRole[]) sc(s.economy.production[r]);
  sc(s.logistics.merchantTonnage); sc(s.logistics.draftAnimals); sc(s.strategic.nuclearWarheads);
}

export function seasonOf(month: number, southern: boolean): number {
  let m = ((month - 1) % 12 + 12) % 12 + 1;
  if (southern) m = ((m + 5) % 12) + 1;
  if (m === 12 || m <= 2) return 3;
  if (m <= 5) return 0;
  if (m <= 8) return 1;
  return 2;
}

export function monthOfDay(startMonth: number, day: number): number {
  return ((startMonth - 1 + Math.floor((day * 12) / 365)) % 12) + 1;
}

function propulsionOf(shipsTech: number): NavalPropulsion {
  return shipsTech <= 3 ? 'oar' : shipsTech <= 6 ? 'sail' : shipsTech <= 8 ? 'steam' : 'modern';
}

const MOUNTED: Record<string, 1> = { horse: 1, wagon: 1, motorized: 1, mechanized: 1, tracked_heavy: 1 };
const VEHICLE: Record<string, 1> = { motorized: 1, mechanized: 1, tracked_heavy: 1 };

/** Land BFS on the global grid from a lat/lon; stops at the first cell satisfying `isTarget` or after maxVisit cells. */
function bfsLand(gt: GlobalTerrain, stamp: Int32Array, gen: number, queue: Int32Array, lat: number, lon: number,
  isTarget: ((gi: number) => boolean) | null, maxVisit: number): { hit: number; visited: number } {
  let start = cellIndex(lat, lon);
  if (gt.cls[start] === T.water) {
    let found = -1;
    const r0 = Math.floor(start / GRID_W), c0 = start % GRID_W;
    for (let ring = 1; ring <= 3 && found < 0; ring++) {
      for (let dr = -ring; dr <= ring && found < 0; dr++) for (let dc = -ring; dc <= ring; dc++) {
        const r = r0 + dr; if (r < 0 || r >= GRID_H) continue;
        const gi = r * GRID_W + ((c0 + dc + GRID_W) % GRID_W);
        if (gt.cls[gi] !== T.water) { found = gi; break; }
      }
    }
    if (found < 0) return { hit: -1, visited: 0 };
    start = found;
  }
  let head = 0, tail = 0;
  queue[tail++] = start; stamp[start] = gen;
  let visited = 0;
  while (head < tail) {
    const gi = queue[head++];
    visited++;
    if (isTarget && isTarget(gi)) return { hit: gi, visited };
    if (visited >= maxVisit) return { hit: -1, visited };
    const r = Math.floor(gi / GRID_W), c = gi % GRID_W;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr; if (rr < 0 || rr >= GRID_H) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const gj = rr * GRID_W + ((c + dc + GRID_W) % GRID_W);
        if (stamp[gj] === gen || gt.cls[gj] === T.water) continue;
        stamp[gj] = gen;
        queue[tail++] = gj;
      }
    }
  }
  return { hit: -1, visited };
}

export function buildSetup(data: EngineData, scenario: Scenario, opts: SimOptions = {}): Setup {
  const m = data.mechanics;
  const missing = validateMechanics(m);
  if (missing.length) throw new Error(`mechanics.json is missing ${missing.length} constant(s) the engine needs: ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ' ...' : ''}`);
  const warnings: string[] = [];
  const battleMode = opts.mode === 'battle';
  const snapById = new Map(data.snapshots.map((s) => [s.id, s] as const));
  const excluded = new Set(scenario.excluded ?? []);

  // ---- 1-3: expand sides, overrides, tech mode -------------------------------------------------
  type Raw = { side: 0 | 1; snap: Snapshot };
  const raws: Raw[] = [];
  for (const side of [0, 1] as const) {
    const seen = new Set<string>();
    for (const id of scenario.sides[side].members) {
      if (seen.has(id)) continue;
      seen.add(id);
      const orig = snapById.get(id);
      if (!orig) { warnings.push(`Unknown snapshot "${id}" on side ${scenario.sides[side].name}; skipped.`); continue; }
      if (excluded.has(orig.nationId)) { warnings.push(`${orig.name} is excluded from this scenario.`); continue; }
      const snap = structuredClone(orig);
      for (const ex of excluded) {
        if (!snap.includes?.includes(ex)) continue;
        const cands = data.snapshots.filter((s) => s.nationId === ex);
        if (!cands.length) { warnings.push(`Cannot remove ${ex} from ${snap.name}: no snapshot of ${ex} to size its share.`); continue; }
        const best = cands.reduce((a, b) => (Math.abs(b.year - snap.year) < Math.abs(a.year - snap.year) ? b : a));
        const share = clamp(best.demography.population.mid / Math.max(1, snap.demography.population.mid), 0, 0.95);
        scaleSnapshot(snap, 1 - share);
        warnings.push(`Removed ${ex} from ${snap.name}: forces, population and economy scaled by ${(1 - share).toFixed(2)} (population share of ${best.id}; approximation).`);
      }
      for (const ov of scenario.overrides ?? []) {
        if (ov.snapshotId !== id) continue;
        if (!setPath(snap, ov.path, ov.value)) warnings.push(`Override ${ov.path} on ${id} could not be applied.`);
      }
      if (scenario.techMode === 'equalized') {
        const L = clamp(scenario.equalizedTech ?? 5, 0, 10);
        for (const c of TECH_CATS) {
          if (!snap.tech[c]) (snap.tech as any)[c] = est(L);
          snap.tech[c].mid = L;
        }
      }
      raws.push({ side, snap });
    }
  }
  for (const side of [0, 1] as const) {
    if (!raws.some((r) => r.side === side)) throw new Error(`Side "${scenario.sides[side].name}" has no valid members.`);
  }

  // ---- 4: theater grid -------------------------------------------------------------------------
  const gt = globalTerrain(data.terrain);
  const grid = buildGrid(gt, scenario.theater.bbox);
  if (grid.k > 1) warnings.push(`Theater has ${(grid.k * grid.k * grid.n).toLocaleString('en-US')} native cells; merged ${grid.k}x${grid.k} to ${grid.n.toLocaleString('en-US')} cells (${grid.cellDeg} deg).`);
  if (opts.terrainOverride != null) {
    for (let i = 0; i < grid.n; i++) if (grid.land[i]) grid.cls[i] = opts.terrainOverride;
  }
  if (grid.landCount === 0) throw new Error('The theater contains no land cells.');
  const southern = (grid.north - (grid.rows * grid.cellDeg) / 2) < 0;

  // Weather odds: the theater's majority Koppen-Geiger zone over its land cells (spec in
  // movement.weatherOddsByZone), zone C when the climate grid is missing or covers no land cell.
  let climateZone: ClimateZone | null = null;
  const weatherOdds = {} as Record<Season, Record<Weather, number>>;
  if (REGIONAL_WEATHER) {
    const zb = data.climate && data.climate.byteLength === CLIMATE_W * CLIMATE_H ? new Uint8Array(data.climate) : null;
    const tz = zb ? theaterZone(zb, grid) : null;
    climateZone = tz?.zone ?? CLIMATE_FALLBACK;
    if (!zb) warnings.push(`No climate grid (climate/zones.bin); weather uses zone ${CLIMATE_FALLBACK} odds.`);
    else if (!tz?.zone) warnings.push(`No theater land cell has a climate zone; weather uses zone ${CLIMATE_FALLBACK} odds.`);
    for (const s of SEASONS) {
      const t = m.movement.weatherOddsByZone[climateZone][s];
      weatherOdds[s] = { clear: t.clear.mid, rain: t.rain.mid, mud: t.mud.mid, snow: t.snow.mid };
    }
  } else for (const s of SEASONS) weatherOdds[s] = m.movement.weatherOdds[s];

  const tmv = (k: string) => (m.movement.terrain as any)[k].mid as number;
  const terrMove = new Float64Array(11), terrAttack = new Float64Array(11), terrMounted = new Float64Array(11), forageYield = new Float64Array(11);
  const TC = ['water', 'plains', 'cropland', 'forest', 'hills', 'mountains', 'desert', 'steppe', 'wetland', 'urban', 'ice'];
  TC.forEach((t, i) => {
    terrMove[i] = tmv(t);
    terrAttack[i] = (m.combat.terrainAttackFactor as any)[t].mid;
    terrMounted[i] = (m.combat.terrainMountedFactor as any)[t].mid;
    forageYield[i] = (m.logistics.forageYield as any)[t].mid;
  });
  let maxTerrMove = 0;
  for (let i = 1; i < 11; i++) maxTerrMove = Math.max(maxTerrMove, terrMove[i]);

  const specialMissing = new Set<string>();
  const specialEffect = (key: string): number => {
    const v = m.combat.specialEffects?.[key];
    if (!v || typeof v.mid !== 'number') {
      if (!specialMissing.has(key)) { specialMissing.add(key); warnings.push(`mechanics combat.specialEffects.${key} missing: that special has no effect.`); }
      return 1;
    }
    return v.mid;
  };

  // ---- members ---------------------------------------------------------------------------------
  const docById = new Map(data.doctrines.map((d) => [d.id, d] as const));
  const members: MemberRT[] = [];
  const sideMembers: [number[], number[]] = [[], []];
  for (const { side, snap } of raws) {
    const idx = members.length;
    const tech = {} as Record<TechCategory, number>;
    for (const c of TECH_CATS) tech[c] = clamp(snap.tech?.[c]?.mid ?? 0, 0, 10);
    const roleTech = (r: number) => (IS_AIR[r] ? tech.air : IS_NAVAL[r] ? tech.ships : tech.weapons);

    // Remap roles that do not exist at this tech level (equalized mode, or data at the edge of an era).
    const forces = snap.military.forces;
    for (const role of ROLES) {
      const e = forces[role];
      if (!e || !(e.count?.mid > 0)) continue;
      const r = RI[role];
      if (byTech(m.lethality.tli[role], roleTech(r)) > 0) continue;
      let target: UnitRole = role, cnt = e.count.mid, ok = false;
      for (let depth = 0; depth < 4; depth++) {
        const opts2 = (m.roleRemap?.[target] ?? []).slice().sort((a, b) => a.fromTech - b.fromTech);
        const L = roleTech(RI[target]);
        let pick = opts2.filter((o) => o.fromTech <= L).pop();
        if (!pick) pick = opts2[0];
        if (!pick) break;
        cnt *= pick.ratio;
        target = pick.to;
        if (byTech(m.lethality.tli[target], roleTech(RI[target])) > 0) { ok = true; break; }
      }
      delete forces[role];
      if (ok && cnt > 0) {
        const dst = forces[target];
        if (dst) {
          const tot = dst.count.mid + cnt;
          dst.quality.mid = (dst.quality.mid * dst.count.mid + (e.quality?.mid ?? 0.5) * cnt) / tot;
          dst.training.mid = (dst.training.mid * dst.count.mid + (e.training?.mid ?? 0.5) * cnt) / tot;
          dst.count.mid = tot;
        } else {
          forces[target] = { count: est(cnt), quality: est(e.quality?.mid ?? 0.5), training: est(e.training?.mid ?? 0.5) };
        }
        warnings.push(`${snap.name}: ${Math.round(e.count.mid).toLocaleString('en-US')} ${role} do not exist at tech ${roleTech(r).toFixed(1)}; converted to ${Math.round(cnt).toLocaleString('en-US')} ${target} (roleRemap).`);
      } else {
        warnings.push(`${snap.name}: ${role} do not exist at tech ${roleTech(r).toFixed(1)} and have no roleRemap entry; dropped.`);
      }
    }

    let doctrine = docById.get(snap.doctrineId);
    if (!doctrine) {
      doctrine = data.doctrines.find((d) => d.archetype && d.era.includes(snap.era)) ?? data.doctrines.find((d) => d.archetype);
      if (doctrine) warnings.push(`${snap.name}: doctrine "${snap.doctrineId}" not found; using archetype ${doctrine.id}.`);
    }
    const ruleYear = scenario.techMode === 'equalized' ? yearFromTech(m, clamp(scenario.equalizedTech ?? 5, 0, 10)) : snap.year;
    // battle breakpoint: the sourced loser casualty share at the break for the member's era
    // (napoleonic sub-key for 1789-1849); OFF: the tech-keyed morale.breakpoint table
    const bpMV: MV = BREAKPOINT_FROM_MODEL_RULES
      ? ruleMV(m.modelRules.breakpoint.loserCasualtyShareAtBreak, ruleYear) ?? m.morale.breakpoint[0]
      : (() => { const mid = byTech(m.morale.breakpoint, tech.weapons); return { ...m.morale.breakpoint[clamp(Math.round(tech.weapons), 0, m.morale.breakpoint.length - 1)], low: mid, mid, high: mid }; })();
    const bp = bpMV.mid;
    if (!doctrine) {
      doctrine = {
        id: 'engine-neutral', name: 'Neutral (no doctrine data)', appliesTo: [], era: [snap.era], archetype: true, grade: 'D',
        weights: { aggression: 0.5, maneuver: 0.5, flanking: 0.5, siegePreference: 0.5, reserveUse: 0.2, scouting: 0.5, retreatThreshold: SYMMETRIC_DOCTRINE_BREAKPOINT ? bp : bp * 0.75, combinedArms: 0.5, initiative: 0.5, logisticsDiscipline: 0.5 },
        weightNotes: {}, specials: [], summary: 'Neutral weights used because no doctrine profile is available.', whyItWorked: 'n/a', whereItFailed: 'n/a', sources: [],
      };
      warnings.push(`${snap.name}: no doctrine profiles loaded; using neutral weights (${SYMMETRIC_DOCTRINE_BREAKPOINT ? 'break at the era breakpoint' : 'retreat at 75% of the breakpoint'}).`);
    }
    const w = doctrine.weights;
    const tli = new Float64Array(NR), qF = new Float64Array(NR), tF = new Float64Array(NR), range = new Float64Array(NR), rate = new Float64Array(NR), rangeClass = new Float64Array(NR);
    const mounted = new Uint8Array(NR), vehicle = new Uint8Array(NR);
    const mob: MobilityClass[] = [];
    const logIdx = Math.round(tech.logistics);
    for (let r = 0; r < NR; r++) {
      const role = ROLES[r];
      tli[r] = byTech(m.lethality.tli[role], roleTech(r));
      range[r] = byTech(m.lethality.rangeKm[role], roleTech(r));
      rangeClass[r] = byTech(m.lethality.rangeKm[role], Math.floor(roleTech(r)));
      const fe = forces[role];
      qF[r] = factor(m.combat.qualityFactor, fe?.quality?.mid ?? 0.5);
      tF[r] = factor(m.combat.trainingFactor, fe?.training?.mid ?? 0.5);
      const rm = m.movement.roleMobility[role];
      const cls = rm[clamp(logIdx, 0, rm.length - 1)];
      mob.push(cls);
      rate[r] = (m.movement.rate as any)[cls]?.mid ?? 0;
      mounted[r] = MOUNTED[cls] ? 1 : 0;
      vehicle[r] = VEHICLE[cls] && !IS_P[r] ? 1 : 0;
    }
    // sea lift: measurement tons (40 cu ft) per vehicle -> GRT (100 cu ft) x 0.4, by definition of the units;
    // no broken stowage (named simplification, a lower bound)
    const TR = m.modelRules.transport;
    const seaTonsPerRole = new Float64Array(NR);
    for (let r = 0; r < NR; r++) {
      if (!IS_LAND[r] || IS_P[r]) continue;
      const kind = mob[r] === 'mechanized' || mob[r] === 'tracked_heavy' ? TR.seaLiftTonsPerVehicle.tracked : mob[r] === 'motorized' ? TR.seaLiftTonsPerVehicle.wheeled : null;
      if (kind) seaTonsPerRole[r] = rule(kind, ruleYear) * 0.4;
    }
    const pMix = new Float64Array(NR);
    let pTot = 0;
    for (let r = 0; r < NR; r++) if (IS_P[r]) { pMix[r] = forces[ROLES[r]]?.count?.mid ?? 0; pTot += pMix[r]; }
    if (pTot > 0) for (let r = 0; r < NR; r++) pMix[r] /= pTot;
    else pMix[RI.infantry_line] = 1;
    const prodDay = new Float64Array(NR);
    for (const role of Object.keys(snap.economy.production ?? {}) as UnitRole[]) {
      const v = snap.economy.production[role]?.mid ?? 0;
      if (RI[role] != null && v > 0) prodDay[RI[role]] = v / 365;
    }
    const levee = doctrine.specials.includes('levee_en_masse');
    const mobArr = m.production.mobilizationDays;
    const mobDays = levee
      ? (() => { const L = clamp(tech.communications, 0, mobArr.length - 1); const i = Math.floor(L); const j = Math.min(i + 1, mobArr.length - 1); const f = L - i; return mobArr[i].low * (1 - f) + mobArr[j].low * f; })()
      : byTech(mobArr, tech.communications);
    const cohortFrac = levee ? m.production.cohortTrainableFraction.high : m.production.cohortTrainableFraction.mid;
    const missionF = RULES_FROM_MODEL_RULES ? m.modelRules.c2.missionCommandDelayFactor.mid : MISSION_COMMAND_DELAY_FACTOR;
    const delay = byTech(m.c2.orderDelayDays, tech.communications) * (doctrine.specials.includes('mission_command') ? missionF : 1);
    const mr: MemberRT = {
      idx, side, snapId: snap.id, nationId: snap.nationId, name: snap.name, snap, doctrine, w,
      ruleYear,
      seaTonsPerSoldier: rule(TR.seaLiftGrtPerSoldier, ruleYear), seaTonsPerRole,
      riverDelayDays: RULES_FROM_MODEL_RULES ? rule(m.modelRules.river.riverCrossingDelayDays, ruleYear) : RIVER_DELAY_DAYS,
      admitLossShare: ATTRITION_FROM_MODEL_RULES ? rule(m.modelRules.attrition.diseaseDeathShareOfAdmissions, ruleYear) : 1 - m.attrition.returnToDuty.mid,
      returnDays: clamp(Math.round(ATTRITION_FROM_MODEL_RULES ? rule(m.modelRules.attrition.returnToDutyDays, ruleYear) : RETURN_TO_DUTY_DAYS), 1, RETURN_RING_DAYS - 1),
      specials: new Set(doctrine.specials), tech, commitment: 1,
      tli, qF, tF, range, rangeClass, rate, mob, mounted, vehicle,
      dispersion: byTech(m.lethality.dispersion, tech.weapons),
      commandF: factor(m.combat.commandFactor, snap.military.commandQuality?.mid ?? 0.5),
      homeDefense: Math.max(1, snap.geography?.homeDefense?.mid ?? 1),
      morale0: clamp(snap.military.morale?.mid ?? 0.5, 0.05, 1),
      cohesion: clamp(snap.military.cohesion?.mid ?? 0.5, 0, 1),
      breakpoint: 0,
      retreat: 0,
      bpMV,
      bpShift: 0,
      retreatThreshold: w.retreatThreshold,
      baseCas: byTech(m.combat.baseDailyCasualtyRate, tech.weapons),
      alpha: byTech(m.combat.powerRatioExponent, tech.weapons),
      pursuit: byTech(m.combat.pursuitLossFraction, tech.weapons),
      capture: byTech(m.combat.captureFraction, tech.weapons),
      fortF: byTech(m.combat.fortificationFactor, tech.fortification),
      supplyRangeKm: Math.max(1, snap.logistics?.supplyRangeKm?.mid ?? 0),
      carriedDays: Math.max(0, byTech(m.logistics.carriedDaysFood, tech.logistics)),
      forageDep: clamp(byTech(m.logistics.forageDependence, tech.logistics), 0, 1),
      animalsPer1000: byTech(m.logistics.animalsPer1000, tech.logistics),
      ammoPer1000: byTech(m.logistics.ammoTonsPer1000CombatDay, tech.weapons),
      supplyPer1000: byTech(m.logistics.supplyTonsPer1000Day, tech.logistics),
      disease: byTech(m.attrition.diseaseDaily, tech.logistics),
      desertion: byTech(m.attrition.desertionDaily, tech.communications),
      orderDelay: delay,
      formationSize: Math.max(1, byTech(m.org.formationSize, tech.weapons)),
      mobilizationDays: Math.max(0, mobDays),
      trainingDays: Math.max(1, byTech(m.production.trainingDays, tech.weapons)),
      roadThroughput: byTech(m.logistics.throughputRoadTonsDay, tech.logistics),
      railThroughput: (snap.logistics?.railKm?.mid ?? 0) > 0 ? m.logistics.throughputRailTonsDay.mid : 0,
      portThroughput: byTech(m.logistics.throughputPortTonsDay, tech.logistics),
      capitalCell: -1, capitalReal: !opts.syntheticCapitals, entryCell: -1, entryBySea: false, entryCostKm: 0, oneWayDays: 0, lift: 0, roundTripDays: 0,
      seaDependent: false, spawnCells: [], pMix, productionPerDay: prodDay,
      reserves: Math.max(0, snap.military.trainedReserves?.mid ?? 0),
      recruitsPerBatchDay: Math.max(0, (snap.economy.annualCohort?.mid ?? 0) * cohortFrac / 365),
      mobilizable0: Math.max(0, (snap.military.mobilizable?.mid ?? 0) - (snap.military.activePersonnel?.mid ?? 0) - (snap.military.trainedReserves?.mid ?? 0)),
      startCells: 0,
      propulsion: propulsionOf(tech.ships),
    };
    // Effective breakpoint at the era mid (the per-seed values are in MemberState, sim.ts):
    // SYMMETRIC_DOCTRINE_BREAKPOINT: the doctrine retreatThreshold shifted by cohesion, withdrawal
    // in good order at WITHDRAW_SHARE_OF_BREAKPOINT of it. OFF: the era breakpoint shifted by
    // cohesion, withdrawal at min(retreatThreshold, that share of the breakpoint).
    mr.bpShift = m.combat.cohesionBreakpointShift.mid * (mr.cohesion - 0.5);
    mr.breakpoint = clamp((SYMMETRIC_DOCTRINE_BREAKPOINT ? w.retreatThreshold : bp) + mr.bpShift, 0.02, 0.98);
    mr.retreat = clamp(SYMMETRIC_DOCTRINE_BREAKPOINT ? WITHDRAW_SHARE_OF_BREAKPOINT * mr.breakpoint : Math.min(w.retreatThreshold, WITHDRAW_SHARE_OF_BREAKPOINT * mr.breakpoint), 0.01, 0.95);
    members.push(mr);
    sideMembers[side].push(idx);
  }

  // ---- places ------------------------------------------------------------------------------------
  const places: PlaceRT[] = [];
  const placeAt = new Int32Array(grid.n).fill(-1);
  const addPlace = (mi: number, p: { name: string; lat: number; lon: number; kind?: string; population?: number }, capital: boolean) => {
    if (!inBbox(grid.bbox, p.lat, p.lon)) return;
    const cell = nearestLand(grid, p.lat, p.lon, 2);
    if (cell < 0) return;
    if (placeAt[cell] >= 0) {
      const q = places[placeAt[cell]];
      if (q.member === mi) { if (capital) { q.capital = true; q.fortified = !opts.unfortifiedCapitals; } return; }
    }
    const kind = capital ? 'capital' : p.kind ?? 'city';
    const pl: PlaceRT = {
      name: p.name, cell, member: mi, side: members[mi].side, kind, pop: p.population ?? 0,
      fortified: (kind === 'capital' && !opts.unfortifiedCapitals) || kind === 'fortress' || kind === 'city', capital, port: kind === 'port' || (grid.flags[cell] & FLAG_COAST) !== 0,
    };
    if (placeAt[cell] < 0) placeAt[cell] = places.length;
    places.push(pl);
  };
  if (!battleMode) {
    for (const mr of members) {
      if (mr.snap.capital) addPlace(mr.idx, { ...mr.snap.capital, kind: 'capital' }, true);
      for (const p of mr.snap.places ?? []) addPlace(mr.idx, p, false);
      for (const p of mr.snap.strategic?.basesAbroad ?? []) addPlace(mr.idx, { ...p, kind: p.kind ?? 'port' }, false);
    }
  }

  // ---- 5: initial control ----------------------------------------------------------------------
  const control0 = new Uint8Array(grid.n).fill(255);
  const owner0 = new Int16Array(grid.n).fill(-1);
  const starts: [Start[], Start[]] = [[], []];
  for (const side of [0, 1] as const) {
    const s = opts.starts?.[side] ?? scenario.sides[side].startPositions?.map((p) => ({ ...p, share: 1 }));
    if (s) starts[side] = s.filter((p) => inBbox(grid.bbox, p.lat, p.lon));
  }
  if (opts.voronoiControl) {
    const sc: [number[], number[]] = [starts[0].map((p) => nearestLand(grid, p.lat, p.lon)), starts[1].map((p) => nearestLand(grid, p.lat, p.lon))];
    for (let i = 0; i < grid.n; i++) {
      if (!grid.land[i]) continue;
      let best = -1, bd = Infinity;
      for (const side of [0, 1] as const) for (const c of sc[side]) {
        if (c < 0) continue;
        const d = haversineKm(grid.lat[i], grid.lon[i], grid.lat[c], grid.lon[c]);
        if (d < bd) { bd = d; best = side; }
      }
      if (best >= 0) { control0[i] = best; owner0[i] = sideMembers[best][0]; }
    }
  } else {
    const capDist = (mi: number, cell: number) => {
      const c = members[mi].snap.capital;
      return c ? haversineKm(c.lat, c.lon, grid.lat[cell], grid.lon[cell]) : 1e9;
    };
    // Polygons first; members without a polygon (border "none") then claim a disc of their
    // area around the capital, nearest cells first, never taking a cell another member's
    // polygon already holds.
    const noPoly: MemberRT[] = [];
    for (const mr of members) {
      const mp = data.borders?.[mr.snapId];
      if (!mp || !mp.length) { noPoly.push(mr); continue; }
      rasterizeMultiPolygon(grid, mp, (cell) => {
        if (!grid.land[cell]) return;
        const o = owner0[cell];
        if (o >= 0 && o !== mr.idx && capDist(o, cell) <= capDist(mr.idx, cell)) return;
        owner0[cell] = mr.idx;
      });
    }
    for (const mr of noPoly) {
      const cap = mr.snap.capital;
      if (!cap || !inBbox(grid.bbox, cap.lat, cap.lon)) {
        warnings.push(`${mr.name}: no border polygon and capital outside the theater; it holds no starting territory here.`);
        continue;
      }
      const areaKm2 = Math.max(0, mr.snap.territory?.areaKm2?.mid ?? 0);
      const rKm = Math.sqrt(areaKm2 / Math.PI);
      const cand: [number, number][] = [];
      for (let i = 0; i < grid.n; i++) {
        if (!grid.land[i]) continue;
        const d = haversineKm(cap.lat, cap.lon, grid.lat[i], grid.lon[i]);
        if (d <= rKm) cand.push([d, i]);
      }
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      // at least the capital cell itself, even when the disc is smaller than one cell
      const capCell = nearestLand(grid, cap.lat, cap.lon, 2);
      if (capCell >= 0 && !cand.some((c) => c[1] === capCell)) cand.unshift([0, capCell]);
      let n = 0;
      for (const [, i] of cand) if (owner0[i] < 0) { owner0[i] = mr.idx; n++; }
      warnings.push(`${mr.name}: no border polygon; territory approximated as a disc of ${Math.round(areaKm2).toLocaleString('en-US')} km2 (r ${Math.round(rKm)} km) around the capital, ${n} cells.`);
    }
    for (let i = 0; i < grid.n; i++) if (owner0[i] >= 0) control0[i] = members[owner0[i]].side;
  }
  const startCells: [number, number] = [0, 0];
  for (let i = 0; i < grid.n; i++) {
    if (control0[i] !== 255) startCells[control0[i]]++;
    if (owner0[i] >= 0) members[owner0[i]].startCells++;
  }

  // ---- 6: commitment and power projection ------------------------------------------------------
  const N = GRID_W * GRID_H;
  const stamp = new Int32Array(N);
  const queue = new Int32Array(N);
  let gen = 0;
  const theaterTarget = (gi: number) => {
    const c = cellCenter(gi);
    if (!inBbox(grid.bbox, c.lat, c.lon)) return false;
    const tc = cellAt(grid, c.lat, c.lon);
    return tc >= 0 && grid.land[tc] === 1;
  };
  const timeLimit = Math.max(1, scenario.victory?.timeLimitDays ?? 730);
  const restF = 1 - m.movement.restDayFraction.mid;
  for (const mr of members) {
    const snap = mr.snap;
    const cap = snap.capital;
    const capIn = !!cap && inBbox(grid.bbox, cap.lat, cap.lon);
    mr.capitalCell = capIn ? nearestLand(grid, cap.lat, cap.lon, 2) : -1;
    let pTotal = 0, landRateMin = Infinity;
    for (let r = 0; r < NR; r++) {
      const c = snap.military.forces[ROLES[r]]?.count?.mid ?? 0;
      if (IS_P[r]) pTotal += c;
      if (IS_LAND[r] && c > 0 && mr.rate[r] > 0) landRateMin = Math.min(landRateMin, mr.rate[r]);
    }
    if (!isFinite(landRateMin)) landRateMin = m.movement.rate.foot.mid;
    // island test (production exposed to blockade)
    if (cap) {
      gen++;
      const comp = bfsLand(gt, stamp, gen, queue, cap.lat, cap.lon, null, ISLAND_CELL_LIMIT + 1);
      mr.seaDependent = comp.visited > 0 && comp.visited <= ISLAND_CELL_LIMIT;
    }
    let share = 1;
    const ownPlaces = places.filter((p) => p.member === mr.idx && control0[p.cell] === mr.side);
    if (battleMode || capIn) {
      share = 1;
    } else if (cap) {
      gen++;
      const b = bfsLand(gt, stamp, gen, queue, cap.lat, cap.lon, theaterTarget, N);
      if (b.hit >= 0) {
        const c = cellCenter(b.hit);
        const entry = nearestLand(grid, c.lat, c.lon, 2);
        const dist = haversineKm(cap.lat, cap.lon, c.lat, c.lon);
        mr.entryCell = entry;
        mr.entryCostKm = dist;
        if (dist > mr.supplyRangeKm) {
          mr.oneWayDays = dist / Math.max(1e-6, landRateMin * restF);
          warnings.push(`${mr.name}: capital is ${Math.round(dist)} km from the theater over land, beyond its supply range (${Math.round(mr.supplyRangeKm)} km); forces march in over ${Math.round(mr.oneWayDays)} days and their home depot is out of reach.`);
        }
      } else {
        // overseas: sea lift
        const ships = (snap.military.forces.ships_major?.count?.mid ?? 0) + (snap.military.forces.ships_minor?.count?.mid ?? 0);
        const lift = byTech(m.naval.troopLiftPerShip, mr.tech.ships) * ships;
        const ports = places.filter((p) => p.member === mr.idx && p.port);
        let entry = ports.length ? ports[0].cell : -1;
        if (entry < 0) {
          let bd = Infinity;
          for (let i = 0; i < grid.n; i++) {
            if (!grid.land[i] || !(grid.flags[i] & FLAG_COAST)) continue;
            const enemyHeld = control0[i] !== 255 && control0[i] !== mr.side;
            const d = haversineKm(cap.lat, cap.lon, grid.lat[i], grid.lon[i]) * (enemyHeld ? 1.5 : 1);
            if (d < bd) { bd = d; entry = i; }
          }
        }
        mr.entryBySea = true;
        mr.seaDependent = true;
        if (entry < 0 || lift <= 0) {
          share = 0;
          warnings.push(`${mr.name}: not land-connected to the theater and ${entry < 0 ? 'the theater has no coast' : 'has no sea lift (troopLiftPerShip x ships = 0)'}; it cannot commit ground forces.`);
        } else {
          const dist = haversineKm(cap.lat, cap.lon, grid.lat[entry], grid.lon[entry]);
          const speed = m.naval.speedKmDay[mr.propulsion].mid;
          mr.oneWayDays = dist / Math.max(1, speed);
          const roundTrip = 2 * mr.oneWayDays;
          const trips = Math.max(1, Math.floor(Math.max(0, timeLimit - mr.oneWayDays) / Math.max(1, roundTrip)) + 1);
          share = pTotal > 0 ? Math.min(1, (lift * trips) / pTotal) : 1;
          mr.lift = lift;
          mr.roundTripDays = roundTrip;
          mr.entryCell = entry;
          mr.entryCostKm = 0;
          warnings.push(`${mr.name}: overseas; sea lift ${Math.round(lift).toLocaleString('en-US')} troops per ${Math.round(roundTrip)}-day round trip, ${Math.round(share * 100)}% of ground forces can arrive within ${timeLimit} days.`);
        }
      }
    }
    const user = scenario.sides[mr.side].commitment?.[mr.snapId];
    if (user != null) share = clamp(user, 0, 1);
    mr.commitment = share;
    // spawn cells: own places (capital first, then by population), else entry
    const ordered = ownPlaces.slice().sort((a, b) => (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || b.pop - a.pop);
    mr.spawnCells = ordered.map((p) => p.cell);
    if (mr.entryCell >= 0) mr.spawnCells.push(mr.entryCell);
  }

  // ---- 7: formations ---------------------------------------------------------------------------
  const seeds: FormationSeed[] = [];
  const startCellsSide: [number[], number[]] = [starts[0].map((p) => nearestLand(grid, p.lat, p.lon)), starts[1].map((p) => nearestLand(grid, p.lat, p.lon))];
  const startShares: [number[], number[]] = [starts[0].map((p) => p.share), starts[1].map((p) => p.share)];
  const fleet0: [Float64Array, Float64Array] = [new Float64Array(NR), new Float64Array(NR)];
  const air0: [Float64Array, Float64Array] = [new Float64Array(NR), new Float64Array(NR)];
  const allocate = (n: number, weights: number[]): number[] => {
    const tot = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map((w) => (n * w) / tot);
    const out = raw.map(Math.floor);
    let left = n - out.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
    return out;
  };
  for (const mr of members) {
    const c = mr.commitment;
    const tot = new Float64Array(NR);
    let pTot = 0, nTot = 0;
    for (let r = 0; r < NR; r++) {
      const v = (mr.snap.military.forces[ROLES[r]]?.count?.mid ?? 0) * c;
      if (!(v > 0)) continue;
      if (IS_LAND[r]) { tot[r] = v; if (IS_P[r]) pTot += v; else nTot += v; }
      else if (IS_NAVAL[r]) fleet0[mr.side][r] += v;
      else if (IS_AIR[r]) air0[mr.side][r] += v;
    }
    if (pTot + nTot <= 0) continue;
    let nF = pTot > 0 ? Math.max(1, Math.ceil(pTot / mr.formationSize)) : 1;
    if (nF > MAX_FORMATIONS_PER_MEMBER) {
      warnings.push(`${mr.name}: ${nF} formations capped at ${MAX_FORMATIONS_PER_MEMBER}; formations are proportionally larger.`);
      nF = MAX_FORMATIONS_PER_MEMBER;
    }
    // where do they start?
    let cells: number[] = [], weights: number[] = [];
    const ss = startCellsSide[mr.side];
    if (ss.length && ss.some((x) => x >= 0)) {
      cells = ss; weights = startShares[mr.side];
    } else if (mr.oneWayDays === 0 || mr.entryCell < 0) {
      const own = places.filter((p) => p.member === mr.idx && control0[p.cell] === mr.side);
      if (own.length) {
        const known = own.filter((p) => p.pop > 0).map((p) => p.pop).sort((a, b) => a - b);
        const med = known.length ? known[Math.floor(known.length / 2)] : 1;
        cells = own.map((p) => p.cell);
        weights = own.map((p) => (p.pop > 0 ? p.pop : med));
      } else {
        const ownCells: number[] = [];
        for (let i = 0; i < grid.n; i++) if (owner0[i] === mr.idx) ownCells.push(i);
        if (ownCells.length) {
          const step = Math.max(1, Math.floor(ownCells.length / Math.min(ownCells.length, 16)));
          for (let i = 0; i < ownCells.length; i += step) cells.push(ownCells[i]);
          weights = cells.map(() => 1);
        } else if (mr.entryCell >= 0) {
          cells = [mr.entryCell]; weights = [1];
        }
      }
    } else {
      cells = [mr.entryCell]; weights = [1];
    }
    if (!cells.length || cells.every((x) => x < 0)) {
      warnings.push(`${mr.name}: no own territory, place or entry point in the theater; its ground forces cannot deploy.`);
      mr.commitment = 0;
      continue;
    }
    const valid = cells.map((x, i) => [x, weights[i]] as const).filter(([x]) => x >= 0);
    const alloc = allocate(nF, valid.map((v) => v[1]));
    const per = new Float64Array(NR);
    for (let r = 0; r < NR; r++) per[r] = tot[r] / nF;
    const perP = pTot / nF;
    const lift = mr.lift;
    const roundTrip = mr.roundTripDays;
    let cum = 0;
    valid.forEach(([cell], k) => {
      for (let j = 0; j < alloc[k]; j++) {
        let arrive = 0;
        if (mr.entryBySea && lift > 0) {
          arrive = Math.ceil(mr.oneWayDays + Math.floor(cum / lift) * roundTrip);
          cum += perP;
        } else if (mr.oneWayDays > 0) {
          arrive = Math.ceil(mr.oneWayDays);
        }
        seeds.push({ member: mr.idx, cell, counts: per.slice(), arriveDay: arrive });
      }
    });
    if (mr.spawnCells.length === 0) mr.spawnCells = valid.map((v) => v[0]);
  }

  // ---- pools: fleet and air per side -------------------------------------------------------------
  const poolTech = ([0, 1] as const).map((side) => {
    let sw = 0, aw = 0, ws = 0, ships = 0, airT = 0, wpn = 0, cmd = 0;
    const q = new Float64Array(NR), t = new Float64Array(NR);
    for (const mi of sideMembers[side]) {
      const mr = members[mi];
      const ns = (mr.snap.military.forces.ships_major?.count?.mid ?? 0) + (mr.snap.military.forces.ships_minor?.count?.mid ?? 0) + (mr.snap.military.forces.submarines?.count?.mid ?? 0);
      let na = 0;
      for (const r of [RI.aircraft_fighter, RI.aircraft_strike, RI.helicopters, RI.drones]) na += mr.snap.military.forces[ROLES[r]]?.count?.mid ?? 0;
      const wgt = 1 + ns + na;
      ships += mr.tech.ships * (ns + 1e-9); sw += ns + 1e-9;
      airT += mr.tech.air * (na + 1e-9); aw += na + 1e-9;
      wpn += mr.tech.weapons * wgt; cmd += mr.commandF * wgt; ws += wgt;
      for (let r = 0; r < NR; r++) { q[r] += mr.qF[r] * wgt; t[r] += mr.tF[r] * wgt; }
    }
    for (let r = 0; r < NR; r++) { q[r] /= ws; t[r] /= ws; }
    const sT = ships / sw;
    return { ships: sT, air: airT / aw, weapons: wpn / ws, q, t, cmd: cmd / ws, propulsion: propulsionOf(sT) };
  }) as Setup['poolTech'];

  // ---- supply sources ------------------------------------------------------------------------------
  const sources = ([0, 1] as const).map((side) => {
    const cell: number[] = [], member: number[] = [], sea: number[] = [], cost: number[] = [], cap: number[] = [], place: number[] = [];
    places.forEach((p, pi) => {
      if (p.side !== side) return;
      const mr = members[p.member];
      cell.push(p.cell); member.push(p.member); place.push(pi);
      if (p.port && p.kind === 'port') { sea.push(1); cap.push(mr.portThroughput); }
      else { sea.push(0); cap.push(mr.roadThroughput + mr.railThroughput); }
      cost.push(0);
    });
    // Urban land-cover cells of a member's own starting territory are depots too: the
    // snapshots list only major places, and a home army is not fed from a dozen cities.
    for (const mi of sideMembers[side]) {
      const mr = members[mi];
      let k = 0;
      for (let c = 0; c < grid.n && k < MAX_URBAN_SOURCES_PER_MEMBER; c++) {
        if (owner0[c] !== mi || grid.cls[c] !== T.urban || placeAt[c] >= 0) continue;
        cell.push(c); member.push(mi); place.push(-2); sea.push(0); cap.push(mr.roadThroughput + mr.railThroughput); cost.push(0);
        k++;
      }
    }
    for (const mi of sideMembers[side]) {
      const mr = members[mi];
      if (mr.entryCell >= 0) {
        cell.push(mr.entryCell); member.push(mi); place.push(-1);
        sea.push(mr.entryBySea ? 1 : 0);
        cap.push(mr.entryBySea ? mr.portThroughput : mr.roadThroughput + mr.railThroughput);
        cost.push(mr.entryCostKm);
      }
    }
    startCellsSide[side].forEach((c) => {
      if (c < 0) return;
      const mi = sideMembers[side][0];
      const mr = members[mi];
      cell.push(c); member.push(mi); place.push(-1); sea.push(0); cap.push(mr.roadThroughput + mr.railThroughput); cost.push(0);
    });
    return {
      cell: Int32Array.from(cell), member: Int16Array.from(member), sea: Uint8Array.from(sea),
      cost: Float32Array.from(cost), cap: Float64Array.from(cap), place: Int16Array.from(place),
    };
  }) as [SourceList, SourceList];

  // ---- objectives (battle cases) and misc -------------------------------------------------------
  const objectiveCells: [number, number] = [-1, -1];
  for (const side of [0, 1] as const) {
    const o = opts.objectives?.[side];
    if (o && inBbox(grid.bbox, o.lat, o.lon)) objectiveCells[side] = nearestLand(grid, o.lat, o.lon);
    const oc = objectiveCells[side];
    if (o && oc >= 0 && o.kind === 'capture' && control0[oc] !== 1 - side) {
      warnings.push(`${scenario.sides[side].name}: capture objective ${o.name} is ${control0[oc] === side ? 'in its own control' : 'not enemy-held'} at the start; it cannot be won by capture.`);
    }
    if (o && o.kind === 'destroy' && !(o.radiusKm! > 0)) warnings.push(`${scenario.sides[side].name}: destroy objective ${o.name} has no radiusKm; it cannot be won.`);
  }
  if (opts.fortified) {
    for (const side of [0, 1] as const) {
      if (!opts.fortified[side]) continue;
      const c = startCellsSide[side].find((x) => x >= 0) ?? -1;
      if (c < 0) continue;
      const mi = sideMembers[side][0];
      placeAt[c] = places.length;
      places.push({ name: 'Fortified position', cell: c, member: mi, side, kind: 'fortress', pop: 0, fortified: true, fieldWorks: true, capital: false, port: false });
    }
  }

  const lead: [number, number] = [0, 1].map((side) => {
    const ms = sideMembers[side];
    let best = ms[0], bp = -1;
    for (const mi of ms) {
      const p = seeds.filter((s) => s.member === mi).reduce((a, s) => a + s.counts.reduce((x, y) => x + y, 0), 0);
      if (p > bp) { bp = p; best = mi; }
    }
    return best;
  }) as [number, number];
  const friction: [number, number] = [0, 1].map((side) => 1 + m.c2.coalitionFriction.mid * Math.max(0, sideMembers[side].length - 1)) as [number, number];

  const refRate: [number, number] = [0, 1].map((side) => {
    const rates: number[] = [];
    for (const s of seeds) {
      const mr = members[s.member];
      if (mr.side !== side) continue;
      let rmin = Infinity;
      for (let r = 0; r < NR; r++) if (s.counts[r] > 0 && mr.rate[r] > 0) rmin = Math.min(rmin, mr.rate[r]);
      if (isFinite(rmin)) rates.push(rmin);
    }
    rates.sort((a, b) => a - b);
    return rates.length ? rates[Math.floor(rates.length / 2)] : m.movement.rate.foot.mid;
  }) as [number, number];

  return {
    data, scenario, m, opts, battleMode, grid, members, sideMembers,
    sideNames: [scenario.sides[0].name, scenario.sides[1].name], lead, friction,
    rules: RULES_FROM_MODEL_RULES ? {
      noiseSigma: m.modelRules.battle.outcomeNoiseSigma.mid, collapsePersonnel: m.modelRules.collapse.armyCollapsePersonnelFraction.mid,
      collapseMorale: m.modelRules.collapse.armyCollapseMorale.mid, fogError: m.modelRules.intel.fogStrengthError.mid,
      blockade: m.modelRules.naval.blockadeSeaControlThreshold.mid,
    } : { noiseSigma: BATTLE_NOISE_SIGMA, collapsePersonnel: COLLAPSE_PERSONNEL_FRACTION, collapseMorale: COLLAPSE_MORALE, fogError: FOG_STRENGTH_ERROR, blockade: BLOCKADE_SEA_CONTROL },
    places, placeAt, control0, owner0, startCells, seeds, fleet0, air0, poolTech, sources, objectiveCells,
    objectiveKinds: [opts.objectives?.[0]?.kind, opts.objectives?.[1]?.kind],
    objectiveRadiusKm: [opts.objectives?.[0]?.radiusKm ?? 0, opts.objectives?.[1]?.radiusKm ?? 0],
    terrMove, terrAttack, terrMounted, forageYield, maxTerrMove,
    H: Math.max(1, Math.round(m.combat.battleHoursPerDay.mid)),
    southern, climateZone, weatherOdds, warnings,
    theater: { bbox: grid.bbox, cols: grid.cols, rows: grid.rows, cellDeg: grid.cellDeg },
    specialEffect, refRate,
  };
}

export { GRID_RES, techFromYear };
