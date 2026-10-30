// Readers for mechanics constants. The engine reads the `mid` value of an MV,
// except the battle breakpoint, drawn per seed within low/high (sim.ts,
// BREAKPOINT_FROM_MODEL_RULES); sensitivity analysis otherwise swaps low/high
// into `mid` on a copy of the Mechanics object.
import type { ByTech, EraRule, Mechanics, MV, RuleEra } from '../types/mechanics';
import { ERA_SPANS, type EraId } from '../types/schema';
import { TERRAIN_CLASSES } from './terrainClasses';
import { ROLES } from './roles';

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function mid(m: MV): number {
  return m.mid;
}

/** Linear interpolation of a by-tech table at a fractional tech level. */
export function byTech(arr: ByTech, level: number): number {
  const n = arr.length;
  const L = clamp(level, 0, n - 1);
  const i = Math.floor(L);
  if (i >= n - 1) return arr[n - 1].mid;
  const f = L - i;
  return arr[i].mid * (1 - f) + arr[i + 1].mid * f;
}

/** Rating 0..1 -> multiplier: 0 -> low, 0.5 -> mid, 1 -> high (piecewise linear). */
export function factor(m: MV, rating: number): number {
  const r = clamp(rating, 0, 1);
  return r <= 0.5 ? m.low + (m.mid - m.low) * (r / 0.5) : m.mid + (m.high - m.mid) * ((r - 0.5) / 0.5);
}

/** Matrix lookup at integer levels (rounded and clamped to the table). */
export function matrix(m: MV[][], a: number, b: number): number {
  const i = clamp(Math.round(a), 0, m.length - 1);
  const row = m[i];
  const j = clamp(Math.round(b), 0, row.length - 1);
  return row[j].mid;
}

/** Tech level -> year anchor interpolation, and the inverse (year -> level). */
export function techFromYear(m: Mechanics, year: number): number {
  const a = [...m.techLevels].sort((x, y) => x.level - y.level);
  if (year <= a[0].yearAnchor) return a[0].level;
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i].yearAnchor) {
      const f = (year - a[i - 1].yearAnchor) / (a[i].yearAnchor - a[i - 1].yearAnchor);
      return a[i - 1].level + f * (a[i].level - a[i - 1].level);
    }
  }
  return a[a.length - 1].level;
}

/** Tech level -> year (inverse of techFromYear), for era rules in tech-equalized scenarios. */
export function yearFromTech(m: Mechanics, level: number): number {
  const a = [...m.techLevels].sort((x, y) => x.level - y.level);
  if (level <= a[0].level) return a[0].yearAnchor;
  for (let i = 1; i < a.length; i++) {
    if (level <= a[i].level) {
      const f = (level - a[i - 1].level) / (a[i].level - a[i - 1].level);
      return a[i - 1].yearAnchor + f * (a[i].yearAnchor - a[i - 1].yearAnchor);
    }
  }
  return a[a.length - 1].yearAnchor;
}

/** Engine era of a year (ERA_SPANS, clamped to the first and last era). */
export function eraOfYear(year: number): EraId {
  const eras = Object.keys(ERA_SPANS) as EraId[];
  if (year < ERA_SPANS[eras[0]][0]) return eras[0];
  for (const e of eras) if (year >= ERA_SPANS[e][0] && year < ERA_SPANS[e][1]) return e;
  return eras[eras.length - 1];
}

/** Value of a model rule for a year: an MV as is; an era map at `napoleonic` for 1789-1849 when
 *  present, else at the ERA_SPANS era. Undefined when the era has no entry. */
export function ruleMV(r: MV | EraRule, year: number): MV | undefined {
  if (isMV(r)) return r as MV;
  const m = r as EraRule;
  if (year >= 1789 && year < 1850 && m.napoleonic) return m.napoleonic;
  return m[eraOfYear(year) as RuleEra];
}

/** Mid of a model rule for a year, or `fallback` when the era has no entry. */
export function rule(r: MV | EraRule, year: number, fallback = 0): number {
  return ruleMV(r, year)?.mid ?? fallback;
}

const isMV = (x: unknown): boolean => !!x && typeof x === 'object' && typeof (x as MV).mid === 'number';
const isByTech = (x: unknown): boolean => Array.isArray(x) && x.length >= 2 && x.every(isMV);

/**
 * Lists every constant the engine reads that is missing or malformed. The
 * engine refuses to run with a non-empty list rather than inventing a value.
 */
export function validateMechanics(m: Mechanics | undefined | null): string[] {
  const miss: string[] = [];
  if (!m || typeof m !== 'object') return ['mechanics (whole object)'];
  const get = (path: string): unknown => path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), m);
  const need = (path: string, kind: 'mv' | 'bt' | 'mat' | 'arr' | 'obj') => {
    const v = get(path);
    const ok = kind === 'mv' ? isMV(v) : kind === 'bt' ? isByTech(v)
      : kind === 'mat' ? Array.isArray(v) && v.length > 0 && (v as unknown[]).every((r) => Array.isArray(r) && r.length > 0 && (r as unknown[]).every(isMV))
      : kind === 'arr' ? Array.isArray(v) && v.length > 0 : !!v && typeof v === 'object';
    if (!ok) miss.push(path);
  };
  need('techLevels', 'arr');
  for (const r of ROLES) {
    need(`lethality.tli.${r}`, 'bt');
    need(`lethality.rangeKm.${r}`, 'bt');
    const mob = get(`movement.roleMobility.${r}`);
    if (!Array.isArray(mob) || mob.length < 2) miss.push(`movement.roleMobility.${r}`);
  }
  need('lethality.dispersion', 'bt');
  need('lethality.armorMatrix', 'mat');
  need('org.formationSize', 'bt');
  need('roleRemap', 'obj');
  for (const k of ['baseDailyCasualtyRate', 'powerRatioExponent', 'fortificationFactor', 'pursuitLossFraction', 'captureFraction']) need(`combat.${k}`, 'bt');
  for (const k of ['defensePostureFactor', 'surpriseFactor', 'riverCrossingFactor', 'combinedArmsBonus', 'battleHoursPerDay', 'qualityFactor', 'trainingFactor', 'commandFactor', 'cohesionBreakpointShift']) need(`combat.${k}`, 'mv');
  need('combat.specialEffects', 'obj');
  for (const t of TERRAIN_CLASSES) {
    need(`combat.terrainAttackFactor.${t}`, 'mv');
    need(`combat.terrainMountedFactor.${t}`, 'mv');
    need(`movement.terrain.${t}`, 'mv');
    need(`logistics.forageYield.${t}`, 'mv');
  }
  need('morale.breakpoint', 'bt');
  for (const k of ['dailyRecovery', 'supplyShortfallPenalty', 'defeatShock', 'capitalLossShock']) need(`morale.${k}`, 'mv');
  for (const c of ['foot', 'horse', 'wagon', 'rail', 'motorized', 'mechanized', 'tracked_heavy', 'air', 'sea']) need(`movement.rate.${c}`, 'mv');
  need('movement.roadBonus', 'mv');
  need('movement.restDayFraction', 'mv');
  need('movement.marchHoursPerDay', 'mv');
  for (const s of ['spring', 'summer', 'autumn', 'winter']) {
    need(`movement.season.${s}`, 'mv');
    need(`movement.weatherOdds.${s}`, 'obj');
  }
  for (const w of ['clear', 'rain', 'mud', 'snow']) need(`movement.weather.${w}`, 'mv');
  for (const z of ['A', 'BW', 'BS', 'C', 'D', 'E']) {
    for (const s of ['spring', 'summer', 'autumn', 'winter']) for (const w of ['clear', 'rain', 'mud', 'snow']) need(`movement.weatherOddsByZone.${z}.${s}.${w}`, 'mv');
  }
  for (const k of ['foodKgPerPersonDay', 'fodderKgPerAnimalDay', 'fuelTonsPerVehicleDay', 'forageWinterFactor', 'forageDepletion', 'throughputRailTonsDay']) need(`logistics.${k}`, 'mv');
  for (const k of ['animalsPer1000', 'ammoTonsPer1000CombatDay', 'supplyTonsPer1000Day', 'carriedDaysFood', 'forageDependence', 'throughputRoadTonsDay', 'throughputPortTonsDay']) need(`logistics.${k}`, 'bt');
  need('production.mobilizationDays', 'bt');
  need('production.trainingDays', 'bt');
  need('production.cohortTrainableFraction', 'mv');
  need('production.blockadeProductionFactor', 'mv');
  need('siege.daysToReduce', 'mat');
  need('siege.assaultFactor', 'mv');
  need('attrition.diseaseDaily', 'bt');
  need('attrition.desertionDaily', 'bt');
  for (const k of ['starvationMultiplier', 'winterExposure', 'desertHeat', 'returnToDuty']) need(`attrition.${k}`, 'mv');
  for (const p of ['oar', 'sail', 'steam', 'modern']) {
    need(`naval.speedKmDay.${p}`, 'mv');
    for (const s of ['spring', 'summer', 'autumn', 'winter']) need(`naval.weatherDenial.${p}.${s}`, 'mv');
  }
  need('naval.troopLiftPerShip', 'bt');
  need('naval.blockadeInterdiction', 'mv');
  need('air.sortiesPerAircraftDay', 'bt');
  need('air.combatRadiusKm', 'bt');
  for (const k of ['superiorityRatioThreshold', 'airSuperiorityMovementFactor', 'airSuperioritySupplyFactor']) need(`air.${k}`, 'mv');
  const lps = get('air.lossPerSortie');
  if (!Array.isArray(lps) || lps.length !== 11 || !lps.every(isMV)) miss.push('air.lossPerSortie (11 entries)');
  for (const k of ['isrPerLevel', 'precisionStrikePerLevel', 'ewPerLevel', 'cyberPerLevel']) need(`modern.${k}`, 'mv');
  // model rules: MVs, and era maps with every engine era (napoleonic optional; sparse maps
  // only where the thing did not exist in early eras)
  const ERAS = Object.keys(ERA_SPANS) as EraId[];
  const needEra = (path: string, from: EraId = ERAS[0]) => {
    const v = get(path);
    const ok = !!v && typeof v === 'object' && ERAS.slice(ERAS.indexOf(from)).every((e) => isMV((v as any)[e]));
    if (!ok) miss.push(`${path} (era map from ${from})`);
  };
  for (const k of ['battle.outcomeNoiseSigma', 'battle.footPursuitLossFloor', 'collapse.armyCollapsePersonnelFraction', 'collapse.armyCollapseMorale',
    'intel.fogStrengthError', 'c2.missionCommandDelayFactor', 'naval.blockadeSeaControlThreshold',
    'aiForceRatio.attrition', 'aiForceRatio.maneuver']) need(`modelRules.${k}`, 'mv');
  for (const k of ['battle.pursuitDisengageShare', 'river.riverCrossingDelayDays', 'attrition.returnToDutyDays', 'attrition.diseaseDeathShareOfAdmissions',
    'surrender.encircledSurrenderShare', 'transport.seaLiftGrtPerSoldier', 'naval.navalAttritionPerDay',
    'breakpoint.loserCasualtyShareAtBreak']) needEra(`modelRules.${k}`);
  needEra('modelRules.transport.seaLiftTonsPerVehicle.tracked', 'industrial');
  needEra('modelRules.transport.seaLiftTonsPerVehicle.wheeled', 'industrial');
  needEra('modelRules.transport.airLiftTonsPerDayPerAircraft', 'worldwars');
  need('c2.orderDelayDays', 'bt');
  need('c2.coalitionFriction', 'mv');
  for (const k of ['formationLoss', 'cityLoss', 'escalationThreshold']) need(`nuclear.${k}`, 'mv');
  return miss;
}
