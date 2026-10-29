// Readers for mechanics constants. The engine only ever reads the `mid` value
// of an MV; sensitivity analysis swaps low/high into `mid` on a copy of the
// Mechanics object instead of the engine knowing about ranges.
import type { ByTech, Mechanics, MV } from '../types/mechanics';
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
  for (const k of ['defensePostureFactor', 'surpriseFactor', 'riverCrossingFactor', 'combinedArmsBonus', 'battleHoursPerDay', 'qualityFactor', 'trainingFactor', 'commandFactor', 'cohesionBreakpointShift', 'footPursuitFloor']) need(`combat.${k}`, 'mv');
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
  for (const s of ['spring', 'summer', 'autumn', 'winter']) {
    need(`movement.season.${s}`, 'mv');
    need(`movement.weatherOdds.${s}`, 'obj');
  }
  for (const w of ['clear', 'rain', 'mud', 'snow']) need(`movement.weather.${w}`, 'mv');
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
  need('c2.orderDelayDays', 'bt');
  need('c2.coalitionFriction', 'mv');
  for (const k of ['formationLoss', 'cityLoss', 'escalationThreshold']) need(`nuclear.${k}`, 'mv');
  return miss;
}
