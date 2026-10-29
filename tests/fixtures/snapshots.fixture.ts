// TEST FIXTURE, not data. Synthetic nations, doctrine, borders, terrain and
// scenarios for the engine tests. Never imported by src/.
import type { DoctrineProfile, Est, Snapshot, TechCategory, UnitRole } from '../../src/types/schema';
import type { Scenario } from '../../src/types/scenario';
import type { EngineData } from '../../src/engine/protocol';
import { GRID_H, GRID_RES, GRID_W, T, FLAG_RIVER } from '../../src/engine/terrainClasses';
import { FIXTURE_NOTE, FIXTURE_SOURCE, fixtureMechanics } from './mechanics.fixture';

export const est = (mid: number, low = mid, high = mid): Est => ({ low, mid, high, grade: 'D', source: FIXTURE_SOURCE, note: FIXTURE_NOTE });

const TECH: TechCategory[] = ['weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber'];

export interface NationSpec {
  id: string;
  name: string;
  year: number;
  tech: number;                 // every category at this level (air/cyber 0 below 7)
  capital: { lat: number; lon: number };
  /** Rectangle [west, south, east, north] used as the border polygon. */
  rect: [number, number, number, number];
  forces: Partial<Record<UnitRole, number>>;
  reserves?: number;
  supplyRangeKm?: number;
  doctrineId?: string;
  /** Extra cities (supply depots) as [lon, lat]. */
  cities?: [number, number][];
}

export function makeSnapshot(n: NationSpec): Snapshot {
  let personnel = 0;
  const forces: Snapshot['military']['forces'] = {};
  for (const [role, count] of Object.entries(n.forces) as [UnitRole, number][]) {
    forces[role] = { count: est(count), quality: est(0.5), training: est(0.5) };
    if (['infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light'].includes(role)) personnel += count;
  }
  const tech = Object.fromEntries(TECH.map((c) => [c, est((c === 'air' || c === 'cyber') && n.tech < 7 ? 0 : n.tech)])) as Snapshot['tech'];
  const [w, s, e, nn] = n.rect;
  const areaKm2 = (e - w) * (nn - s) * 111 * 111;
  return {
    id: n.id, nationId: n.id.replace(/-?-\d+$/, ''), includes: [], name: n.name, year: n.year,
    era: n.year < -1200 ? 'bronze' : n.year >= 1991 ? 'modern' : 'industrial', region: 'europe', phase: 'key', tags: ['fixture'],
    capital: { name: `${n.name} capital`, lat: n.capital.lat, lon: n.capital.lon, kind: 'capital', population: 100000 },
    places: (n.cities ?? []).map(([lon, lat], i) => ({ name: `${n.name} city ${i + 1}`, lat, lon, kind: 'city' as const, population: 50000 })),
    territory: { border: 'fixture', areaKm2: est(areaKm2) },
    demography: { population: est(personnel * 20), urbanization: est(0.2) },
    military: {
      activePersonnel: est(personnel), trainedReserves: est(n.reserves ?? 0), supportPersonnel: est(0),
      mobilizationRatio: est(0.1), mobilizable: est(personnel * 2), forces,
      commandQuality: est(0.5), cohesion: est(0.5), morale: est(0.7),
    },
    tech,
    economy: {
      gdpPerCapita: est(1000), gdp: est(1e9), milSpendShare: est(0.02), industrialShare: est(0.2), foodSurplus: est(0.1),
      annualCohort: est(personnel / 10), production: {},
    },
    logistics: {
      roadKm: est(1000), railKm: est(0), majorPorts: est(0), merchantTonnage: est(0),
      supplyRangeKm: est(n.supplyRangeKm ?? 300), draftAnimals: est(10000),
    },
    strategic: { nuclearWarheads: est(0), basesAbroad: [] },
    doctrineId: n.doctrineId ?? 'fixture-neutral',
    geography: { climate: 'Cfb', chokepoints: [], homeDefense: est(1) },
    notes: FIXTURE_NOTE,
  };
}

export const fixtureDoctrine: DoctrineProfile = {
  id: 'fixture-neutral', name: 'Fixture neutral doctrine', appliesTo: ['archetype'], era: ['bronze', 'industrial', 'modern'],
  archetype: true, grade: 'D',
  weights: {
    aggression: 0.7, maneuver: 0.5, flanking: 0.5, siegePreference: 0.5, reserveUse: 0.1, scouting: 0.5,
    retreatThreshold: 0.15, combinedArms: 0.5, initiative: 0.5, logisticsDiscipline: 0.5,
  },
  weightNotes: {}, specials: [], summary: FIXTURE_NOTE, whyItWorked: FIXTURE_NOTE, whereItFailed: FIXTURE_NOTE, sources: [],
};

const rectPoly = ([w, s, e, n]: [number, number, number, number]): number[][][][] => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];

/**
 * Synthetic global terrain grid (grid.bin layout: class u8, flags u8, elev i16,
 * relief u16 per cell): plains on the block lon -20..60, lat -20..50, sea
 * elsewhere, a hill band at lat 4..5 and a river along lon 5.0..5.25.
 */
export function fixtureTerrain(): ArrayBuffer {
  const N = GRID_W * GRID_H;
  const buf = new ArrayBuffer(N * 6);
  const cls = new Uint8Array(buf, 0, N);
  const flags = new Uint8Array(buf, N, N);
  const elev = new Int16Array(buf, 2 * N, N);
  const relief = new Uint16Array(buf, 4 * N, N);
  for (let row = 0; row < GRID_H; row++) {
    const lat = 90 - (row + 0.5) * GRID_RES;
    for (let col = 0; col < GRID_W; col++) {
      const lon = -180 + (col + 0.5) * GRID_RES;
      const i = row * GRID_W + col;
      const land = lon > -20 && lon < 60 && lat > -20 && lat < 50;
      cls[i] = land ? (lat > 4 && lat < 5 ? T.hills : T.plains) : T.water;
      elev[i] = land ? 100 : -100;
      relief[i] = cls[i] === T.hills ? 300 : 20;
      if (land && lon > 5 && lon < 5.25) flags[i] |= FLAG_RIVER;
    }
  }
  return buf;
}

export const NATIONS = {
  westland: {
    id: 'westland-1900', name: 'Westland', year: 1900, tech: 6, capital: { lat: 5, lon: 1 }, rect: [0, 0, 5, 10], cities: [[3.5, 2], [3.5, 5.5], [3.5, 8]],
    forces: { infantry_line: 40000, cavalry_light: 5000, artillery: 100 }, reserves: 20000,
  },
  eastland: {
    id: 'eastland-1900', name: 'Eastland', year: 1900, tech: 6, capital: { lat: 5, lon: 9 }, rect: [5, 0, 10, 10], cities: [[6.5, 2], [6.5, 5.5], [6.5, 8]],
    forces: { infantry_line: 35000, cavalry_heavy: 5000, artillery: 120 }, reserves: 20000,
  },
  chariotState: {
    id: 'chariot-state--1300', name: 'Chariot State', year: -1300, tech: 2, capital: { lat: 5, lon: 1 }, rect: [0, 0, 5, 10],
    forces: { infantry_line: 20000, missile_infantry: 5000, chariots: 500 }, supplyRangeKm: 100,
  },
  superpower: {
    id: 'superpower-2026', name: 'Superpower', year: 2026, tech: 10, capital: { lat: 5, lon: 9 }, rect: [5, 0, 10, 10], cities: [[6.5, 2], [6.5, 5.5], [6.5, 8]],
    forces: { infantry_line: 60000, armor: 800, ifv_apc: 1500, artillery: 400, aircraft_fighter: 300, aircraft_strike: 200, drones: 500, missiles: 100, air_defense: 50 },
    supplyRangeKm: 500,
  },
  // formationSize is 1000 in the fixture, so 2.2M personnel make about 2200 formations per side
  massA: {
    id: 'mass-a-1900', name: 'Mass A', year: 1900, tech: 6, capital: { lat: 10, lon: 2 }, rect: [0, 0, 10, 20], cities: [[8, 3], [8, 7], [8, 13], [8, 17]],
    forces: { infantry_line: 2_000_000, cavalry_light: 200_000, artillery: 2000 },
  },
  massB: {
    id: 'mass-b-1900', name: 'Mass B', year: 1900, tech: 6, capital: { lat: 10, lon: 18 }, rect: [10, 0, 20, 20], cities: [[12, 3], [12, 7], [12, 13], [12, 17]],
    forces: { infantry_line: 2_000_000, cavalry_heavy: 200_000, artillery: 2000 },
  },
} satisfies Record<string, NationSpec>;

export function fixtureData(): EngineData {
  const specs = Object.values(NATIONS) as NationSpec[];
  return {
    snapshots: specs.map(makeSnapshot),
    doctrines: [fixtureDoctrine],
    mechanics: fixtureMechanics(),
    terrain: fixtureTerrain(),
    borders: Object.fromEntries(specs.map((n) => [n.id, rectPoly(n.rect)])),
  };
}

export function fixtureScenario(a: NationSpec, b: NationSpec, bbox: [number, number, number, number], extra: Partial<Scenario> = {}): Scenario {
  return {
    version: 1, id: `fixture-${a.id}-vs-${b.id}`, name: `${a.name} vs ${b.name}`, description: FIXTURE_NOTE,
    sides: [
      { name: a.name, color: '#aa0000', members: [a.id] },
      { name: b.name, color: '#0000aa', members: [b.id] },
    ],
    excluded: [], techMode: 'native', theater: { name: 'Fixture theater', bbox }, startMonth: 6,
    rules: { naval: true, air: true, weather: true, supply: true, fogOfWar: false, nuclear: false },
    victory: { capitalCaptured: true, territoryShare: 0.6, armyCollapse: true, timeLimitDays: 365 },
    seed: 1, overrides: [],
    ...extra,
  };
}

export const basicScenario = (seed = 1) => fixtureScenario(NATIONS.westland, NATIONS.eastland, [0, 0, 10, 10], { seed });
export const absurdScenario = (seed = 1) => fixtureScenario(NATIONS.chariotState, NATIONS.superpower, [0, 0, 10, 10], { seed });
export const perfScenario = (seed = 1) => fixtureScenario(NATIONS.massA, NATIONS.massB, [0, 0, 20, 20], { seed });
