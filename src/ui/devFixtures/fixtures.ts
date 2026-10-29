// OBVIOUSLY SYNTHETIC dev fixtures, loaded only with ?fixtures=1 while the real
// data pipeline output is empty. Every value is grade D with source
// "dev-fixture:synthetic" and the UI shows a red "DEV FIXTURES" banner. Never real data.
import type { Coalition, Est, Nation, Snapshot, TechCategory, UnitRole, EraId, RegionId } from '../../types/schema';
import type { Scenario } from '../../types/scenario';
import { defaultScenario } from '../scenarioDefaults';

const est = (mid: number, spread = 0.3): Est => ({
  low: mid * (1 - spread), mid, high: mid * (1 + spread), grade: 'D',
  source: 'dev-fixture:synthetic', note: 'SYNTHETIC DEV FIXTURE - not researched data',
});

const TECH: TechCategory[] = ['weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber'];

function snap(nationId: string, name: string, year: number, era: EraId, region: RegionId, tech: number,
  forces: Partial<Record<UnitRole, number>>, lat: number, lon: number): Snapshot {
  const pop = 5e6 + tech * 4e6;
  return {
    id: `${nationId}-${year}`, nationId, includes: [], name, year, era, region, phase: 'key',
    tags: ['dev-fixture', 'synthetic'],
    capital: { name: `${name} capital`, lat, lon, kind: 'capital' },
    places: [{ name: `${name} port`, lat: lat - 1, lon: lon + 1, kind: 'port' }],
    territory: { border: 'none', areaKm2: est(300000) },
    demography: { population: est(pop), urbanization: est(0.1 + tech * 0.06) },
    military: {
      activePersonnel: est(200000), trainedReserves: est(100000), supportPersonnel: est(30000),
      mobilizationRatio: est(0.05), mobilizable: est(pop * 0.05),
      forces: Object.fromEntries(Object.entries(forces).map(([r, n]) => [r, { count: est(n as number), quality: est(0.5), training: est(0.5) }])),
      commandQuality: est(0.5), cohesion: est(0.5), morale: est(0.5),
    },
    tech: Object.fromEntries(TECH.map((c) => [c, est(c === 'cyber' ? Math.max(0, tech - 8) : c === 'air' || c === 'isr' ? Math.max(0, tech - 6) : tech, 0.1)])) as Snapshot['tech'],
    economy: {
      gdpPerCapita: est(1000 * tech), gdp: est(1000 * tech * pop), milSpendShare: est(0.03), industrialShare: est(0.2),
      foodSurplus: est(0.1), annualCohort: est(pop * 0.01), production: {},
    },
    logistics: {
      roadKm: est(20000), railKm: est(tech >= 7 ? 10000 : 0), majorPorts: est(3), merchantTonnage: est(1e5),
      supplyRangeKm: est(100 + tech * 40), draftAnimals: est(50000),
    },
    strategic: { nuclearWarheads: est(0, 0), basesAbroad: [] },
    doctrineId: 'dev-fixture',
    geography: { climate: 'Cfb', chokepoints: [], homeDefense: est(1.1, 0.05) },
    notes: 'SYNTHETIC DEV FIXTURE. Exists only so the UI can be developed before the data pipeline has output.',
  };
}

export function devFixtures() {
  const snapshots: Snapshot[] = [
    snap('devfix-alpha', 'DEV Fixture Alpha (synthetic)', -100, 'iron', 'europe', 3.2, { infantry_line: 80000, cavalry_light: 8000, missile_infantry: 6000 }, 45, 10),
    snap('devfix-alpha', 'DEV Fixture Alpha (synthetic)', 1800, 'industrial', 'europe', 6, { infantry_line: 150000, cavalry_heavy: 20000, artillery: 600 }, 45, 10),
    snap('devfix-beta', 'DEV Fixture Beta (synthetic)', 1250, 'medieval', 'central_asia', 4, { cavalry_light: 90000, cavalry_heavy: 20000 }, 47, 30),
    snap('devfix-gamma', 'DEV Fixture Gamma (synthetic)', 2026, 'modern', 'europe', 9.6, { infantry_line: 60000, armor: 300, ifv_apc: 900, artillery: 200, aircraft_fighter: 120, helicopters: 80, drones: 200 }, 50, 5),
  ];
  const nations: Nation[] = [
    { id: 'devfix-alpha', name: 'DEV Fixture Alpha (synthetic)', aliases: ['alpha'], region: 'europe', snapshotIds: ['devfix-alpha--100', 'devfix-alpha-1800'] },
    { id: 'devfix-beta', name: 'DEV Fixture Beta (synthetic)', aliases: ['beta'], region: 'central_asia', snapshotIds: ['devfix-beta-1250'] },
    { id: 'devfix-gamma', name: 'DEV Fixture Gamma (synthetic)', aliases: ['gamma'], region: 'europe', snapshotIds: ['devfix-gamma-2026'] },
  ];
  const coalitions: Coalition[] = [
    { id: 'devfix-pact', name: 'DEV Fixture Pact (synthetic)', year: 1800, members: ['devfix-alpha-1800', 'devfix-beta-1250'], note: 'synthetic', sources: [] },
  ];
  const borders: Record<string, number[][][][]> = {
    'devfix-alpha--100': [[[[5, 41], [16, 41], [16, 48], [5, 48], [5, 41]]]],
    'devfix-gamma-2026': [[[[0, 47], [9, 47], [9, 53], [0, 53], [0, 47]]]],
  };
  const p = defaultScenario();
  const presets: Scenario[] = [{
    ...p, id: 'devfix-preset', name: 'DEV Fixture Alpha -100 vs Gamma 2026 (synthetic)',
    description: 'Synthetic dev fixture preset. Not a real scenario.',
    sides: [{ ...p.sides[0], name: 'Alpha', members: ['devfix-alpha--100'] }, { ...p.sides[1], name: 'Gamma', members: ['devfix-gamma-2026'] }],
  }];
  return { snapshots, nations, coalitions, borders, presets };
}
