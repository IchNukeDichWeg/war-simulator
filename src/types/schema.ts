// Data schema for nation snapshots, doctrine profiles and mechanics constants.
// The JSON Schema in data/schema/*.schema.json is generated from the same
// definitions (data-pipeline/schema.ts) and is what the pipeline validates
// raw research output against. Change both together.

/** Confidence grade shown in the UI next to every value. */
export type Grade = 'A' | 'B' | 'C' | 'D';
// A documented / officially reported
// B scholarly estimate with a range
// C reconstructed from analogies or indirect evidence
// D educated guess, flagged as such

/**
 * One estimated number. Every numeric field in a snapshot is an Est.
 * `source` is a fetched URL, "isbn:<isbn>" / "doi:<doi>" for printed works
 * (page in the note), or "derived:<method-id>" where the method is documented
 * in data/SOURCES.md (never an invented citation).
 * Invariant: low <= mid <= high.
 */
export interface Est {
  low: number;
  mid: number;
  high: number;
  grade: Grade;
  source: string;
  note: string;
}

export type EraId =
  | 'bronze'      // 3000 to 1200 BCE
  | 'iron'        // 1200 BCE to 476 CE (Iron Age and Classical)
  | 'medieval'    // 476 to 1500
  | 'gunpowder'   // 1500 to 1789
  | 'industrial'  // 1789 to 1914 (Napoleonic and industrial)
  | 'worldwars'   // 1914 to 1945
  | 'coldwar'     // 1945 to 1991
  | 'modern';     // 1991 to 2026

export type RegionId =
  | 'europe' | 'mena' | 'subsaharan_africa' | 'central_asia' | 'south_asia'
  | 'east_asia' | 'southeast_asia' | 'north_america' | 'latin_america' | 'oceania';

export type SnapshotPhase = 'rise' | 'peak' | 'decline' | 'current' | 'key';

export type TerrainClass =
  | 'water' | 'plains' | 'cropland' | 'forest' | 'hills' | 'mountains'
  | 'desert' | 'steppe' | 'wetland' | 'urban' | 'ice';

/** Era spans are half-open [start, end). Years use historical numbering:
 *  480 BCE = -480, there is no year 0. */
export const ERA_SPANS: Record<EraId, [number, number]> = {
  bronze: [-3000, -1200], iron: [-1200, 476], medieval: [476, 1500], gunpowder: [1500, 1789],
  industrial: [1789, 1914], worldwars: [1914, 1945], coldwar: [1945, 1991], modern: [1991, 2027],
};

/**
 * Canonical unit roles. Lethality of a role comes from the tech matrix
 * (mechanics/lethality.json) indexed by the snapshot's tech level, so the same
 * role spans eras: "infantry_line" is a hoplite phalanx at tech 3 and a rifle
 * company at tech 7.
 * Measure: P = personnel, N = number of platforms/pieces/hulls/launchers.
 */
export type UnitRole =
  | 'infantry_line'     // P  close-order / line / main infantry
  | 'infantry_light'    // P  skirmishers, light infantry, irregulars
  | 'missile_infantry'  // P  archers, crossbowmen, slingers (pre-gunpowder)
  | 'cavalry_heavy'     // P  shock cavalry, cataphracts, knights, cuirassiers
  | 'cavalry_light'     // P  light horse, horse archers, dragoons, scouts
  | 'chariots'          // N  war chariots
  | 'elephants'         // N  war elephants
  | 'artillery'         // N  siege engines, cannon, field guns, howitzers, MLRS
  | 'armor'             // N  tanks
  | 'ifv_apc'           // N  armoured personnel carriers / IFVs
  | 'aircraft_fighter'  // N  air superiority / multirole
  | 'aircraft_strike'   // N  bombers, attack aircraft
  | 'helicopters'       // N  attack + utility helicopters
  | 'drones'            // N  military UAVs (armed + ISR)
  | 'ships_major'       // N  capital ships / major surface combatants / war galleys
  | 'ships_minor'       // N  patrol, light combatants, small galleys
  | 'submarines'        // N
  | 'missiles'          // N  ballistic / cruise missile launchers
  | 'air_defense';      // N  SAM / AAA batteries

export const PERSONNEL_ROLES: UnitRole[] = [
  'infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light',
];

export interface ForceEntry {
  count: Est;     // personnel (P roles) or platforms (N roles)
  quality: Est;   // 0..1 equipment quality relative to the era's best
  training: Est;  // 0..1 training / experience
}

export type TechCategory =
  | 'weapons' | 'armor' | 'ships' | 'fortification' | 'logistics'
  | 'communications' | 'isr' | 'air' | 'cyber';

/**
 * Tech levels are on a 0..10 scale anchored to documented technology
 * (see data/mechanics/tech_levels.json for the anchors): 1 early bronze,
 * 2 late bronze/chariot, 3 iron/classical, 4 high medieval, 5 early gunpowder,
 * 6 Napoleonic, 7 c.1900 industrial, 8 WWII, 9 late Cold War, 10 2026 frontier.
 * Fractions allowed. Categories that do not exist yet in an era are 0.
 */
export type TechLevels = Record<TechCategory, Est>;

export interface Place {
  name: string;
  lat: number;
  lon: number;
  kind?: 'capital' | 'city' | 'fortress' | 'port' | 'chokepoint';
  population?: number;
}

export interface Snapshot {
  id: string;            // exactly `${nationId}-${year}`, BCE negative: "persia-achaemenid--480"
  nationId: string;      // stable id shared by all snapshots of one polity
  /** nationIds whose population and forces are counted INSIDE this snapshot
   *  (e.g. british-empire-1939 includes india, australia...). Removing a
   *  nation from a scenario also removes its share from any snapshot that
   *  includes it. Population convention: everything inside `territory.border`,
   *  colonies only if listed here; the note says which. */
  includes: string[];
  name: string;          // display name at this time
  year: number;          // negative = BCE
  era: EraId;
  region: RegionId;
  phase: SnapshotPhase;
  /** Free-text tags for search: "empire", "city-state", "nomadic", "NATO" ... */
  tags: string[];
  capital: Place;
  places: Place[];       // major cities, fortresses, ports, chokepoints
  territory: {
    /** "hb:<file-year>:<NAME>" historical-basemaps, "ne:<ISO3>" Natural Earth,
     *  or "none" when no polygon is available. Always approximate. */
    border: string;
    areaKm2: Est;
  };
  demography: {
    population: Est;
    urbanization: Est;       // fraction 0..1
  };
  military: {
    // Force accounting (validator enforces):
    //   sum(P-role counts) + supportPersonnel <= activePersonnel <= mobilizable
    // `forces` is the standing order of battle at the snapshot date (campaign
    // start for wartime snapshots), NOT the fully mobilized strength. Crews of
    // tanks/ships/aircraft, navy and air force personnel, logistics and staff
    // are supportPersonnel, never P roles. Paramilitary excluded unless the note says so.
    activePersonnel: Est;
    trainedReserves: Est;    // reservists callable within ~30 days
    supportPersonnel: Est;
    mobilizationRatio: Est;  // max fraction of population mobilizable in total war
    mobilizable: Est;        // total personnel mobilizable (normally pop x ratio)
    forces: Partial<Record<UnitRole, ForceEntry>>;  // 'missiles' counts launchers
    commandQuality: Est;     // 0..1
    cohesion: Est;           // 0..1 baseline unit cohesion
    morale: Est;             // 0..1 baseline morale
  };
  tech: TechLevels;
  economy: {
    gdpPerCapita: Est;       // 2011 international $ (Maddison convention)
    gdp: Est;                // 2011 international $ total
    milSpendShare: Est;      // fraction of GDP on the military in peacetime
    industrialShare: Est;    // fraction of output from industry/crafts
    foodSurplus: Est;        // fraction of food production above subsistence
    annualCohort: Est;       // persons reaching military age per year (conscript pool inflow)
    /** Wartime production capacity per year, per platform role, at full war economy. */
    production: Partial<Record<UnitRole, Est>>;
  };
  logistics: {
    roadKm: Est;             // paved or engineered roads
    railKm: Est;             // 0 before ~1830
    majorPorts: Est;         // count of ports able to supply a fleet/army
    merchantTonnage: Est;    // merchant fleet capacity, metric tons deadweight
    supplyRangeKm: Est;      // distance an army can operate beyond its supply base
    draftAnimals: Est;       // horses/mules/oxen/camels available for transport
  };
  strategic: {
    nuclearWarheads: Est;    // 0 for all pre-1945 snapshots (derived:absent-in-era)
    basesAbroad: Place[];    // overseas bases / colonies usable as supply bases
  };
  doctrineId: string;        // key into data/doctrine/*.json
  geography: {
    climate: string;         // dominant Koppen group, e.g. "Csa"
    chokepoints: string[];
    homeDefense: Est;        // multiplier >= 1 on defensive combat power at home (derived:home-defense rubric)
    /** Fractions summing to 1, computed by the pipeline from the border and
     *  the terrain grid (derived:terrain-from-landcover). Not researched. */
    terrainMix?: Partial<Record<TerrainClass, number>>;
  };
  /** Free-form research notes, caveats, ancient-source warnings. */
  notes: string;
}

export interface Nation {
  id: string;
  name: string;
  aliases: string[];
  region: RegionId;
  snapshotIds: string[];
}

/** A named alliance at a point in time (data/coalitions.json). */
export interface Coalition {
  id: string;
  name: string;
  year: number;
  members: string[];         // snapshotIds
  note: string;
  sources: { title: string; url: string }[];
}

/** A user edit, stored in scenarios and share URLs. jsonPath is dot-separated
 *  into the snapshot, e.g. "military.forces.armor.count.mid". */
export interface Override { snapshotId: string; path: string; value: number }

/** Weighted parameters the command AI reads. All weights 0..1. */
export interface DoctrineProfile {
  id: string;
  name: string;
  appliesTo: string[];       // nationIds or "archetype"
  era: EraId[];
  archetype: boolean;        // true = shared profile used where data is thin
  grade: Grade;              // how well the weights are supported by the sources
  weights: {
    aggression: number;       // attack vs wait
    maneuver: number;         // 1 maneuver, 0 attrition
    flanking: number;
    siegePreference: number;  // 1 seeks sieges, 0 seeks open battle
    reserveUse: number;       // fraction held back
    scouting: number;
    retreatThreshold: number; // fraction of starting strength LOST at which a formation withdraws
                              // in good order; the engine caps it at 0.9 x the breakpoint, where it routs
    combinedArms: number;
    initiative: number;       // decentralised command / mission tactics
    logisticsDiscipline: number; // how strictly operations stay within supply
  };
  /** One line per weight saying which source/behaviour justifies the number. */
  weightNotes: Record<string, string>;
  /** Named special behaviours the engine implements (SPECIALS in data-pipeline/schema.ts). */
  specials: string[];
  summary: string;           // how they actually fought
  whyItWorked: string;
  whereItFailed: string;
  sources: { title: string; url: string }[];
}
