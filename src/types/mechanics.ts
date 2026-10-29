// Contract between the mechanics research (data/mechanics/*.json) and the
// engine. Every constant the engine uses for real-world behaviour lives here
// with its range and source, never as a bare literal in engine code.

import type { Grade, TechCategory, TerrainClass, UnitRole } from './schema';
export type { TerrainClass } from './schema';

/** A sourced mechanics constant. Same field names as Est so the editor and the
 *  sensitivity analysis treat both alike. */
export interface MV {
  low: number;
  mid: number;
  high: number;
  grade: Grade;
  source: string;   // URL, isbn:/doi:, or "derived:<method>" documented in data/SOURCES.md
  note: string;
}

/** Index 0..10 = tech level. Fractional levels interpolate linearly. */
export type ByTech = MV[];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'mud' | 'snow';

export type MobilityClass =
  | 'foot' | 'horse' | 'wagon' | 'rail' | 'motorized' | 'mechanized' | 'tracked_heavy' | 'air' | 'sea';

export type NavalPropulsion = 'oar' | 'sail' | 'steam' | 'modern';

export interface Mechanics {
  version: string;

  /** 11 anchors, level 0..10. */
  techLevels: { level: number; yearAnchor: number; label: string; description: string; source: string }[];

  lethality: {
    /** Dupuy-style Theoretical Lethality Index per person (P roles) or
     *  platform (N roles) at each weapons tech level. Rate of fire, range,
     *  accuracy and reliability are folded into TLI. 0 = role absent at that level. */
    tli: Record<UnitRole, ByTech>;
    /** Dupuy dispersion factor by tech level (1 = antiquity). OLI = TLI / dispersion. */
    dispersion: ByTech;
    /** Effectiveness multiplier of weapons tech W against armor tech A,
     *  armorMatrix[W][A], both integer levels 0..10. */
    armorMatrix: MV[][];
    /** Effective engagement range in km per role and weapons tech level. Decides
     *  which side fires first (archers before melee, artillery standoff). */
    rangeKm: Record<UnitRole, ByTech>;
  };

  org: {
    /** Personnel per manoeuvre formation (legion, corps, division, brigade) by tech level. */
    formationSize: ByTech;
  };

  /** When a role does not exist at the target tech level (era-equalized mode),
   *  its personnel/platforms are converted to another role. Ordered by fromTech. */
  roleRemap: Record<UnitRole, { fromTech: number; to: UnitRole; ratio: number }[]>;

  combat: {
    /** Fraction of engaged strength lost per day by the side in a stand-up
     *  fight at force ratio 1:1, by tech level (Dupuy/Helmbold base rates). */
    baseDailyCasualtyRate: ByTech;
    /** Exponent alpha on the power ratio R in fractional loss rates:
     *  loser-side daily loss = base x R^alpha, other side base x R^-alpha
     *  (Helmbold / Dupuy: casualty rates respond less than proportionally to force ratio). */
    powerRatioExponent: ByTech;
    defensePostureFactor: MV;      // prepared defence vs hasty attack
    fortificationFactor: ByTech;   // per fortification tech level, for a fortified city
    surpriseFactor: MV;
    pursuitLossFraction: ByTech;   // casualty fraction of a routed force during pursuit
    /** Minimum pursuer share for a winner without cavalry or vehicles: pursuit = pursuitLossFraction
     *  x max(winner mobile share, footPursuitFloor). PLACEHOLDER until sourced (0 = mounted only). */
    footPursuitFloor: MV;
    captureFraction: ByTech;       // fraction of a beaten force's losses that are prisoners
    terrainAttackFactor: Record<TerrainClass, MV>;
    terrainMountedFactor: Record<TerrainClass, MV>;
    riverCrossingFactor: MV;       // attacker multiplier when attacking across a major river
    combinedArmsBonus: MV;
    battleHoursPerDay: MV;
    /** Converts 0..1 snapshot ratings into combat multipliers: factor = low at
     *  rating 0, high at rating 1, mid at 0.5 (Dupuy CEV style). */
    qualityFactor: MV;
    trainingFactor: MV;
    commandFactor: MV;
    /** Shift of the morale breakpoint per unit of cohesion above/below 0.5. */
    cohesionBreakpointShift: MV;
    /** Multipliers for doctrine specials in battle. Keys: phalanxFront, phalanxFlank,
     *  horseArcheryOpening, feignedRetreatPursuerLoss, fieldFortification,
     *  massedArtillery, defenseInDepth, humanWavePower, humanWaveOwnLoss,
     *  siegeEngineering, blitzExploitation, deepBattleBreakthrough. */
    specialEffects: Record<string, MV>;
  };

  morale: {
    breakpoint: ByTech;            // cumulative casualty fraction at which baseline units rout
    dailyRecovery: MV;
    supplyShortfallPenalty: MV;
    defeatShock: MV;
    capitalLossShock: MV;
  };

  movement: {
    rate: Record<MobilityClass, MV>;           // sustained km/day on good roads in summer
    /** Mobility class of each role at each tech level (index 0..10). */
    roleMobility: Record<UnitRole, MobilityClass[]>;
    terrain: Record<TerrainClass, MV>;         // off-road multiplier
    roadBonus: MV;
    season: Record<Season, MV>;
    weather: Record<Weather, MV>;
    /** Probability of each weather by season in a temperate theater. */
    weatherOdds: Record<Season, Record<Weather, number>>;
    restDayFraction: MV;
  };

  logistics: {
    foodKgPerPersonDay: MV;
    waterLPerPersonDay: MV;
    fodderKgPerAnimalDay: MV;
    animalsPer1000: ByTech;                    // transport + cavalry animals per 1000 troops
    ammoTonsPer1000CombatDay: ByTech;
    supplyTonsPer1000Day: ByTech;              // all classes, non-combat day
    fuelTonsPerVehicleDay: MV;
    carryKgPerSoldier: MV;
    carryKgPerPackAnimal: MV;
    carryKgPerWagon: MV;
    carriedDaysFood: ByTech;
    /** People-days of food per km2 per day available by terrain in the growing season. */
    forageYield: Record<TerrainClass, MV>;
    forageWinterFactor: MV;
    forageDepletion: MV;
    /** Forage dependence by logistics tech: 1 = lives off the land, 0 = fully depot-fed. */
    forageDependence: ByTech;
    throughputRoadTonsDay: ByTech;
    throughputRailTonsDay: MV;
    throughputPortTonsDay: ByTech;
  };

  production: {
    mobilizationDays: ByTech;                 // days to call up trained reserves
    /** Fraction of annualCohort trainable per year in total war. */
    cohortTrainableFraction: MV;
    trainingDays: ByTech;                     // days from call-up to combat-ready recruit
    blockadeProductionFactor: MV;             // production multiplier under full blockade
  };

  siege: {
    /** Days to reduce a fortified city by weapons tech W vs fortification tech F. */
    daysToReduce: MV[][];
    assaultFactor: MV;                        // attacker multiplier for a storm assault
  };

  attrition: {
    diseaseDaily: ByTech;
    starvationMultiplier: MV;
    winterExposure: MV;
    desertHeat: MV;
    desertionDaily: ByTech;                   // at morale <= 0.5
    returnToDuty: MV;
  };

  naval: {
    speedKmDay: Record<NavalPropulsion, MV>;
    enduranceDays: Record<NavalPropulsion, MV>;
    /** Probability per day a fleet cannot sortie due to wind/sea state, by season. */
    weatherDenial: Record<NavalPropulsion, Record<Season, MV>>;
    troopLiftPerShip: ByTech;
    blockadeInterdiction: MV;
  };

  air: {
    sortiesPerAircraftDay: ByTech;
    combatRadiusKm: ByTech;
    /** Fighter-strength ratio (own/enemy) above which a side holds air superiority. */
    superiorityRatioThreshold: MV;
    airSuperiorityMovementFactor: MV;
    airSuperioritySupplyFactor: MV;
    /** Attacker aircraft loss fraction per sortie indexed by (air-defense tech minus
     *  air tech) from -5..5 (11 entries). */
    lossPerSortie: MV[];
  };

  modern: {
    /** Combat multiplier per level of tech gap (own minus enemy, clamped -5..5),
     *  using the category named in each key. */
    isrPerLevel: MV;               // category isr
    precisionStrikePerLevel: MV;   // category weapons, only at weapons tech >= 8
    ewPerLevel: MV;                // category communications
    cyberPerLevel: MV;             // category cyber
  };

  c2: {
    orderDelayDays: ByTech;        // by communications tech
    coalitionFriction: MV;         // coordination penalty per extra nation in a side
  };

  nuclear: {
    formationLoss: MV;
    cityLoss: MV;
    escalationThreshold: MV;
  };
}

type Range = { low: number; mid: number; high: number };

/** A historical battle or campaign for backtesting (data/battles/*.json). */
export interface BattleCase {
  id: string;
  name: string;
  year: number;
  kind: 'battle' | 'campaign';
  /** Battle: single point. Campaign: bbox [west, south, east, north] defines the theater. */
  location: { lat: number; lon: number; radiusKm: number };
  bbox?: [number, number, number, number];
  terrain: TerrainClass;
  season: Season;
  /** The attacker had to cross a river to close (contested crossing). Default false. */
  riverCrossing?: boolean;
  sides: [BattleSide, BattleSide];
  outcome: {
    winner: 0 | 1 | 'draw';
    durationDays: Range;           // fractional days allowed (Gaugamela ~ 0.4)
    /** Total losses (killed + wounded + captured) per side. */
    losses: [Range, Range];
    note: string;
  };
  sources: { title: string; url: string }[];
  grade: Grade;
}

export interface BattleSide {
  name: string;
  posture: 'attack' | 'defend';
  snapshotId?: string;
  forces: Partial<Record<UnitRole, Range>>;
  tech?: Partial<Record<TechCategory, number>>;
  commandQuality?: number;
  morale?: number;
  training?: number;
  doctrineId?: string;
  fortified?: boolean;
  /** Defender in a prepared defence (QJM 'prepared', defensePostureFactor): dug in and deployed
   *  in advance, not a hasty or marching defence. Default false. */
  prepared?: boolean;
  surprise?: boolean;
  /** Campaign only: where formations start and what they are. */
  startPositions?: { lat: number; lon: number; share: number }[];
  /** Campaign victory objective for this side, e.g. capture this place. */
  objective?: { name: string; lat: number; lon: number };
  reinforcements?: { day: number; forces: Partial<Record<UnitRole, Range>> }[];
  note?: string;
}
