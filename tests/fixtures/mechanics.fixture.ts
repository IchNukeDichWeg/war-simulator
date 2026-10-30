// TEST FIXTURE, not data. Synthetic mechanics with round, obviously made-up
// numbers so the engine tests do not depend on the research files. Never
// imported by src/.
import type { ByTech, EraRule, Mechanics, MV, MobilityClass, NavalPropulsion, Season, Weather } from '../../src/types/mechanics';
import type { TerrainClass, UnitRole } from '../../src/types/schema';

export const FIXTURE_NOTE = 'TEST FIXTURE, not data';
export const FIXTURE_SOURCE = 'derived:mech-composite';

export const mv = (mid: number, low = mid, high = mid): MV => ({ low, mid, high, grade: 'D', source: FIXTURE_SOURCE, note: FIXTURE_NOTE });
/** ByTech from a function of the tech level 0..10. */
export const bt = (fn: (t: number) => number): ByTech => Array.from({ length: 11 }, (_, t) => mv(fn(t)));
const flat = (x: number): ByTech => bt(() => x);

const ROLES: UnitRole[] = [
  'infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light', 'chariots', 'elephants',
  'artillery', 'armor', 'ifv_apc', 'aircraft_fighter', 'aircraft_strike', 'helicopters', 'drones', 'ships_major',
  'ships_minor', 'submarines', 'missiles', 'air_defense',
];
const TERRAIN: TerrainClass[] = ['water', 'plains', 'cropland', 'forest', 'hills', 'mountains', 'desert', 'steppe', 'wetland', 'urban', 'ice'];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Tech level from which a role exists in the fixture world. */
const ROLE_FROM: Record<UnitRole, number> = {
  infantry_line: 0, infantry_light: 0, missile_infantry: 0, cavalry_heavy: 2, cavalry_light: 2, chariots: 2, elephants: 3,
  artillery: 4, armor: 7, ifv_apc: 8, aircraft_fighter: 7, aircraft_strike: 7, helicopters: 8, drones: 9,
  ships_major: 1, ships_minor: 1, submarines: 7, missiles: 8, air_defense: 8,
};
/** Synthetic per-person (P) or per-platform (N) lethality scale. */
const ROLE_SCALE: Record<UnitRole, number> = {
  infantry_line: 1, infantry_light: 0.8, missile_infantry: 1, cavalry_heavy: 1.5, cavalry_light: 1.2, chariots: 5, elephants: 10,
  artillery: 50, armor: 200, ifv_apc: 80, aircraft_fighter: 100, aircraft_strike: 400, helicopters: 150, drones: 30,
  ships_major: 300, ships_minor: 60, submarines: 200, missiles: 500, air_defense: 100,
};
const tli = (r: UnitRole): ByTech => bt((t) => (t < ROLE_FROM[r] ? 0 : ROLE_SCALE[r] * 10 * 2 ** t));
const range = (r: UnitRole): ByTech => bt((t) => {
  if (t < ROLE_FROM[r]) return 0;
  if (r === 'missile_infantry' || r === 'artillery') return 0.2 * (t + 1);
  if (r === 'missiles' || r === 'aircraft_strike' || r === 'drones') return 50;
  return 0.1 * (t + 1);
});
const mob = (r: UnitRole): MobilityClass[] => Array.from({ length: 11 }, (_, t): MobilityClass => {
  if (r.startsWith('aircraft') || r === 'helicopters' || r === 'drones') return 'air';
  if (r.startsWith('ships') || r === 'submarines') return 'sea';
  if (r === 'armor') return 'tracked_heavy';
  if (r === 'ifv_apc') return 'mechanized';
  if (r === 'missiles' || r === 'air_defense') return 'motorized';
  if (r === 'artillery') return t >= 7 ? 'motorized' : 'wagon';
  if (r.startsWith('cavalry') || r === 'chariots' || r === 'elephants') return 'horse';
  return t >= 8 ? 'motorized' : 'foot';
});

const perTerrain = (fn: (c: TerrainClass) => number): Record<TerrainClass, MV> =>
  Object.fromEntries(TERRAIN.map((c) => [c, mv(fn(c))])) as Record<TerrainClass, MV>;
const perRole = <T>(fn: (r: UnitRole) => T): Record<UnitRole, T> => Object.fromEntries(ROLES.map((r) => [r, fn(r)])) as Record<UnitRole, T>;
const matrix = (fn: (w: number, a: number) => number): MV[][] =>
  Array.from({ length: 11 }, (_, w) => Array.from({ length: 11 }, (_, a) => mv(fn(w, a))));

const weatherOdds: Record<Season, Record<Weather, number>> = {
  spring: { clear: 0.6, rain: 0.3, mud: 0.1, snow: 0 },
  summer: { clear: 0.8, rain: 0.2, mud: 0, snow: 0 },
  autumn: { clear: 0.6, rain: 0.3, mud: 0.1, snow: 0 },
  winter: { clear: 0.5, rain: 0.2, mud: 0.1, snow: 0.2 },
};
const naval = <T>(fn: (p: NavalPropulsion) => T): Record<NavalPropulsion, T> =>
  ({ oar: fn('oar'), sail: fn('sail'), steam: fn('steam'), modern: fn('modern') });

/** Era map with one value for every rule era (EraRule). */
const era = (v: number): EraRule => Object.fromEntries(
  ['bronze', 'iron', 'medieval', 'gunpowder', 'napoleonic', 'industrial', 'worldwars', 'coldwar', 'modern'].map((e) => [e, mv(v)]));

export function fixtureMechanics(): Mechanics {
  return {
    version: 'fixture',
    modelRules: {
      battle: { outcomeNoiseSigma: mv(0.15), pursuitDisengageShare: era(0.7), footPursuitLossFloor: mv(0.09) },
      river: { riverCrossingDelayDays: era(0.5) },
      attrition: { returnToDutyDays: era(30), diseaseDeathShareOfAdmissions: era(0.5) },
      collapse: { armyCollapsePersonnelFraction: mv(0.1), armyCollapseMorale: mv(0.15) },
      surrender: { encircledSurrenderShare: era(0.8) },
      breakpoint: { loserCasualtyShareAtBreak: era(0.2), winnerCasualtyShareAtEnd: era(0.05) },
      intel: { fogStrengthError: mv(0.5) },
      c2: { missionCommandDelayFactor: mv(0.5) },
      naval: { blockadeSeaControlThreshold: mv(0.6), navalAttritionPerDay: era(0.001) },
      transport: {
        seaLiftGrtPerSoldier: era(5), seaLiftTonsPerVehicle: { tracked: era(40), wheeled: era(8) },
        airLiftTonsPerDayPerAircraft: era(2), strategicBombingProductionLossPer1000Tons: era(0),
      },
    },
    techLevels: Array.from({ length: 11 }, (_, t) => ({
      level: t, yearAnchor: [-3000, -2000, -1300, -300, 1200, 1600, 1800, 1900, 1940, 1985, 2026][t],
      label: `fixture level ${t}`, description: FIXTURE_NOTE, source: FIXTURE_SOURCE,
    })),
    lethality: {
      tli: perRole(tli),
      dispersion: bt((t) => 10 ** Math.max(0, (t - 4) * 0.6)),
      armorMatrix: matrix((w, a) => Math.min(2, Math.max(0.25, 1 + 0.1 * (w - a)))),
      rangeKm: perRole(range),
    },
    org: { formationSize: flat(1000) },
    roleRemap: perRole(() => []),
    combat: {
      baseDailyCasualtyRate: bt((t) => (t >= 8 ? 0.02 : 0.1)),
      powerRatioExponent: flat(0.5),
      defensePostureFactor: mv(1.5),
      fortificationFactor: flat(2),
      surpriseFactor: mv(1.5),
      pursuitLossFraction: flat(0.3),
      captureFraction: flat(0.2),
      terrainAttackFactor: perTerrain((c) => (c === 'plains' || c === 'steppe' || c === 'desert' ? 1 : 0.8)),
      terrainMountedFactor: perTerrain((c) => (c === 'plains' || c === 'steppe' || c === 'desert' ? 1 : 0.5)),
      riverCrossingFactor: mv(0.5),
      combinedArmsBonus: mv(0.2),
      battleHoursPerDay: mv(10),
      qualityFactor: mv(1, 0.5, 1.5),
      trainingFactor: mv(1, 0.5, 1.5),
      commandFactor: mv(1, 0.5, 1.5),
      cohesionBreakpointShift: mv(0.2),
      specialEffects: Object.fromEntries([
        'phalanxFront', 'phalanxFlank', 'horseArcheryOpening', 'feignedRetreatPursuerLoss', 'fieldFortification', 'massedArtillery',
        'defenseInDepth', 'humanWavePower', 'humanWaveOwnLoss', 'siegeEngineering', 'blitzExploitation', 'deepBattleBreakthrough',
      ].map((k) => [k, mv(k === 'phalanxFlank' ? 0.5 : 1.2)])),
    },
    morale: {
      breakpoint: flat(0.2),
      dailyRecovery: mv(0.05),
      supplyShortfallPenalty: mv(0.05),
      defeatShock: mv(0.1),
      capitalLossShock: mv(0.2),
    },
    movement: {
      rate: {
        foot: mv(20), horse: mv(40), wagon: mv(20), rail: mv(300), motorized: mv(150), mechanized: mv(100),
        tracked_heavy: mv(60), air: mv(1000), sea: mv(300),
      },
      roleMobility: perRole(mob),
      terrain: perTerrain((c) => (c === 'water' ? 0 : c === 'plains' ? 0.6 : c === 'mountains' ? 0.3 : 0.5)),
      roadBonus: mv(1.5),
      season: { spring: mv(0.9), summer: mv(1), autumn: mv(0.9), winter: mv(0.7) },
      weather: { clear: mv(1), rain: mv(0.8), mud: mv(0.5), snow: mv(0.6) },
      weatherOdds,
      // Every zone carries the same table, so a fixture run draws the same weather with or without a climate grid.
      weatherOddsByZone: Object.fromEntries((['A', 'BW', 'BS', 'C', 'D', 'E'] as const).map((z) => [z, Object.fromEntries(SEASONS.map((s) => [s, {
        clear: mv(weatherOdds[s].clear), rain: mv(weatherOdds[s].rain), mud: mv(weatherOdds[s].mud), snow: mv(weatherOdds[s].snow),
      }]))])) as Mechanics['movement']['weatherOddsByZone'],
      restDayFraction: mv(0.1),
    },
    logistics: {
      foodKgPerPersonDay: mv(1.5),
      waterLPerPersonDay: mv(5),
      fodderKgPerAnimalDay: mv(10),
      animalsPer1000: bt((t) => (t >= 8 ? 0 : 200)),
      ammoTonsPer1000CombatDay: bt((t) => 0.1 * 2 ** (t / 2)),
      supplyTonsPer1000Day: bt((t) => 2 + 3 * t),
      fuelTonsPerVehicleDay: mv(0.2),
      carryKgPerSoldier: mv(30),
      carryKgPerPackAnimal: mv(100),
      carryKgPerWagon: mv(500),
      carriedDaysFood: flat(5),
      forageYield: perTerrain((c) => (c === 'water' || c === 'ice' ? 0 : c === 'urban' ? 200 : 20)),
      forageWinterFactor: mv(0.5),
      forageDepletion: mv(0.3),
      forageDependence: bt((t) => Math.max(0, 1 - t / 10)),
      throughputRoadTonsDay: bt((t) => 1000 * 2 ** (t / 2)),
      throughputRailTonsDay: mv(5000),
      throughputPortTonsDay: bt((t) => 200 * 2 ** (t / 2)),
    },
    production: {
      mobilizationDays: flat(20),
      cohortTrainableFraction: mv(0.5),
      trainingDays: flat(60),
      blockadeProductionFactor: mv(0.7),
    },
    siege: {
      daysToReduce: matrix((w, f) => Math.max(5, 30 + 20 * (f - w))),
      assaultFactor: mv(3),
    },
    attrition: {
      diseaseDaily: bt((t) => (t >= 8 ? 0.001 : 0.003)),
      starvationMultiplier: mv(2),
      winterExposure: mv(1.5),
      desertHeat: mv(1.5),
      desertionDaily: flat(0.002),
      returnToDuty: mv(0.5),
    },
    naval: {
      speedKmDay: naval((p) => mv(p === 'oar' ? 100 : p === 'sail' ? 150 : p === 'steam' ? 400 : 700)),
      enduranceDays: naval(() => mv(30)),
      weatherDenial: naval(() => Object.fromEntries(SEASONS.map((s) => [s, mv(s === 'winter' ? 0.3 : 0.1)])) as Record<Season, MV>),
      troopLiftPerShip: bt((t) => 50 * (t + 1)),
      blockadeInterdiction: mv(0.7),
    },
    air: {
      sortiesPerAircraftDay: bt((t) => (t >= 7 ? 1 : 0)),
      combatRadiusKm: bt((t) => (t >= 7 ? 100 * (t - 6) : 0)),
      superiorityRatioThreshold: mv(2),
      airSuperiorityMovementFactor: mv(0.7),
      airSuperioritySupplyFactor: mv(0.7),
      lossPerSortie: Array.from({ length: 11 }, (_, i) => mv(0.001 * 2 ** (i / 2))),
    },
    modern: { isrPerLevel: mv(0.1), precisionStrikePerLevel: mv(0.1), ewPerLevel: mv(0.1), cyberPerLevel: mv(0.05) },
    c2: { orderDelayDays: bt((t) => Math.max(0.2, 2 - 0.2 * t)), coalitionFriction: mv(0.1) },
    nuclear: { formationLoss: mv(0.2), cityLoss: mv(0.3), escalationThreshold: mv(0.3) },
  };
}

