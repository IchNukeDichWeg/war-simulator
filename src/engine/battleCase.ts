// Backtest runner: builds a scenario from a historical BattleCase and runs it.
// Battle cases: a small theater around the location with the case's terrain on
// every land cell, the defender on the location and the attacker one cell west,
// sim in 'battle' mode (ends when one side breaks; fractional days).
// Campaign cases: the case bbox with real terrain, start positions and
// objectives from the case, control split by nearest start position.
import type { EngineData, RunResult } from './protocol';
import type { BattleCase, BattleSide } from '../types/mechanics';
import type { Snapshot, TechCategory, UnitRole } from '../types/schema';
import type { Scenario } from '../types/scenario';
import type { SimOptions } from './setup';
import { TECH_CATS } from './setup';
import { createSim, runToEnd } from './sim';
import { techFromYear, clamp } from './mech';
import { T } from './terrainClasses';
import { GRID_RES } from './terrainClasses';
import { IS_P, RI } from './roles';
import { CASE_CAPITAL_UNFORTIFIED, CASE_SUPPLY_RANGE_FROM_SNAPSHOT, CASE_SUPPLY_RULE_ON } from './constants';

export interface BattleCaseResult {
  winner: 0 | 1 | 'draw';
  durationDays: number;
  losses: [number, number];
  result: RunResult;
  warnings: string[];
}

const est = (x: number, note: string) => ({ low: x, mid: x, high: x, grade: 'D' as const, source: 'derived:battle-case', note });

/** Neutral rating used where neither the case nor a snapshot gives one (0.5 maps to the MV mid). */
const NEUTRAL_RATING = 0.5;

/** The snapshot nearest a synthesized side in logistics tech, then in year: donor of supplyRangeKm. */
function supplyDonor(data: EngineData, logTech: number, year: number): Snapshot | undefined {
  let best: Snapshot | undefined, bt = Infinity, by = Infinity;
  for (const s of data.snapshots) {
    const r = s.logistics?.supplyRangeKm?.mid;
    if (!(r > 0)) continue;
    const dt = Math.abs((s.tech.logistics?.mid ?? 0) - logTech), dy = Math.abs(s.year - year);
    if (dt < bt - 1e-9 || (Math.abs(dt - bt) <= 1e-9 && (dy < by || (dy === by && best && s.id < best.id)))) { best = s; bt = dt; by = dy; }
  }
  return best;
}

function sideSnapshot(data: EngineData, bc: BattleCase, i: 0 | 1, home: { lat: number; lon: number }, warnings: string[]): Snapshot {
  const side: BattleSide = bc.sides[i];
  const base = side.snapshotId ? data.snapshots.find((s) => s.id === side.snapshotId) : undefined;
  if (side.snapshotId && !base) warnings.push(`${bc.id}: snapshot ${side.snapshotId} not found; side ${i} synthesized from the case.`);
  const id = `bc-${bc.id}-${i}`;
  const yearTech = techFromYear(data.mechanics, bc.year);
  const tech = {} as Snapshot['tech'];
  const missingTech: string[] = [];
  for (const c of TECH_CATS) {
    const v = side.tech?.[c as TechCategory] ?? base?.tech?.[c]?.mid;
    if (v == null) missingTech.push(c);
    const fallback = c === 'air' || c === 'cyber' ? 0 : yearTech;
    tech[c] = est(clamp(v ?? fallback, 0, 10), v == null ? 'from year via techLevels anchors' : 'battle case');
  }
  if (missingTech.length) warnings.push(`${bc.id} side ${i}: tech ${missingTech.join(', ')} not given; ${missingTech.filter((c) => c !== 'air' && c !== 'cyber').length ? `year anchor ${yearTech.toFixed(1)} used` : ''}${missingTech.some((c) => c === 'air' || c === 'cyber') ? ' (air/cyber 0)' : ''}.`);
  const forces: Snapshot['military']['forces'] = {};
  let personnel = 0;
  for (const [role, r] of Object.entries(side.forces) as [UnitRole, { mid: number }][]) {
    if (!r || !(r.mid > 0) || RI[role] == null) continue;
    const b = base?.military.forces[role];
    forces[role] = {
      count: est(r.mid, 'battle case'),
      quality: est(b?.quality?.mid ?? NEUTRAL_RATING, b ? 'snapshot' : 'neutral'),
      training: est(side.training ?? b?.training?.mid ?? NEUTRAL_RATING, side.training != null ? 'battle case' : b ? 'snapshot' : 'neutral'),
    };
    if (IS_P[RI[role]]) personnel += r.mid;
  }
  let supplyRangeKm: Snapshot['logistics']['supplyRangeKm'] = est(0, 'unknown: forces live off stocks and forage');
  if (!base && CASE_SUPPLY_RANGE_FROM_SNAPSHOT) {
    const donor = supplyDonor(data, tech.logistics.mid, bc.year);
    if (donor) {
      supplyRangeKm = { ...donor.logistics.supplyRangeKm, note: `borrowed from ${donor.id} (nearest logistics tech, then year)` };
      warnings.push(`${bc.id} side ${i}: supply range ${Math.round(supplyRangeKm.mid)} km borrowed from ${donor.id}.`);
    }
  }
  // the synthesized 'capital' is the side's main start position, so it lies in its own
  // territory (a capital on the battle location fell to the enemy on day 1)
  const snap: Snapshot = {
    id, nationId: id, includes: [], name: side.name, year: bc.year, era: base?.era ?? 'iron', region: base?.region ?? 'europe', phase: 'key', tags: [],
    capital: { name: `${side.name} base`, lat: home.lat, lon: home.lon, kind: 'capital' },
    places: [],
    territory: { border: 'none', areaKm2: est(0, 'battle case') },
    demography: { population: est(base?.demography.population.mid ?? personnel, 'n/a'), urbanization: est(0, 'n/a') },
    military: {
      activePersonnel: est(personnel, 'battle case'), trainedReserves: est(0, 'battle case'), supportPersonnel: est(0, 'battle case'),
      mobilizationRatio: est(0, 'battle case'), mobilizable: est(personnel, 'battle case'), forces,
      commandQuality: est(side.commandQuality ?? base?.military.commandQuality.mid ?? NEUTRAL_RATING, 'battle case'),
      cohesion: est(base?.military.cohesion.mid ?? NEUTRAL_RATING, base ? 'snapshot' : 'neutral'),
      morale: est(side.morale ?? base?.military.morale.mid ?? NEUTRAL_RATING, 'battle case'),
    },
    tech,
    economy: {
      gdpPerCapita: est(0, 'n/a'), gdp: est(0, 'n/a'), milSpendShare: est(0, 'n/a'), industrialShare: est(0, 'n/a'),
      foodSurplus: est(0, 'n/a'), annualCohort: est(0, 'n/a'), production: {},
    },
    logistics: base ? structuredClone(base.logistics) : {
      roadKm: est(0, 'n/a'), railKm: est(0, 'n/a'), majorPorts: est(0, 'n/a'), merchantTonnage: est(0, 'n/a'),
      supplyRangeKm, draftAnimals: est(0, 'n/a'),
    },
    strategic: { nuclearWarheads: est(0, 'battle case'), basesAbroad: [] },
    doctrineId: side.doctrineId ?? base?.doctrineId ?? '',
    geography: { climate: '', chokepoints: [], homeDefense: est(base?.geography.homeDefense.mid ?? 1, base ? 'snapshot' : 'neutral') },
    notes: `Synthesized for backtest ${bc.id}.`,
  };
  return snap;
}

const SEASON_MONTH = { spring: 4, summer: 7, autumn: 10, winter: 1 } as const;
const toCounts = (f: Partial<Record<UnitRole, { mid: number }>>): Partial<Record<UnitRole, number>> =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v && v.mid > 0).map(([k, v]) => [k, v!.mid]));

export function battleCaseScenario(data: EngineData, bc: BattleCase, seed: number): { data: EngineData; scenario: Scenario; opts: SimOptions; warnings: string[] } {
  const warnings: string[] = [];
  const loc = bc.location;
  const isBattle = bc.kind === 'battle' || !bc.bbox;
  const base0 = bc.sides[0].snapshotId && data.snapshots.some((s) => s.id === bc.sides[0].snapshotId);
  const base1 = bc.sides[1].snapshotId && data.snapshots.some((s) => s.id === bc.sides[1].snapshotId);
  const supplyOn = !!(base0 && base1) || (CASE_SUPPLY_RANGE_FROM_SNAPSHOT && CASE_SUPPLY_RULE_ON);
  if (!isBattle && !supplyOn) warnings.push(`${bc.id}: supply rule off (a side has no snapshot with logistics data).`);
  let bbox: [number, number, number, number];
  if (isBattle) {
    const halfLat = Math.max(loc.radiusKm / 111, 3 * GRID_RES);
    const halfLon = halfLat / Math.max(0.2, Math.cos((loc.lat * Math.PI) / 180));
    bbox = [loc.lon - halfLon, loc.lat - halfLat, loc.lon + halfLon, loc.lat + halfLat];
  } else bbox = bc.bbox!;
  let month: number = SEASON_MONTH[bc.season] ?? 7;
  if (loc.lat < 0) month = ((month + 5) % 12) + 1;   // setup flips seasons south of the equator
  const hi = Math.max(1, bc.outcome.durationDays.high);
  const scenario: Scenario = {
    version: 1, id: `backtest-${bc.id}`, name: bc.name, description: `Backtest of ${bc.name} (${bc.year}).`,
    sides: [
      { name: bc.sides[0].name, color: '#d04a3a', members: [`bc-${bc.id}-0`] },
      { name: bc.sides[1].name, color: '#3a78d0', members: [`bc-${bc.id}-1`] },
    ],
    excluded: [], techMode: 'native',
    theater: { name: bc.name, bbox },
    startMonth: month,
    // Synthesized sides borrow a supply range (CASE_SUPPLY_RANGE_FROM_SNAPSHOT); throughput comes
    // from mechanics by tech. Without a range, supply runs only when both sides have snapshots.
    rules: { naval: !isBattle, air: true, weather: !isBattle, supply: supplyOn, fogOfWar: false, nuclear: false },
    victory: { capitalCaptured: false, territoryShare: 0, armyCollapse: true, timeLimitDays: Math.ceil(isBattle ? Math.max(3, hi * 3) : Math.max(10, hi * 2)) },
    seed, overrides: [],
  };
  const starts: [{ lat: number; lon: number; share: number }[], { lat: number; lon: number; share: number }[]] = [[], []];
  for (const i of [0, 1] as const) {
    const sp = bc.sides[i].startPositions;
    if (!isBattle && sp && sp.length) starts[i] = sp.map((p) => ({ ...p }));
    else if (isBattle) {
      const att = bc.sides[i].posture === 'attack' && bc.sides[1 - i].posture !== 'attack' ? true : bc.sides[i].posture === 'attack' && i === 0;
      starts[i] = [{ lat: loc.lat, lon: att ? loc.lon - GRID_RES : loc.lon, share: 1 }];
    } else starts[i] = [{ lat: loc.lat, lon: loc.lon + (i === 0 ? -GRID_RES : GRID_RES), share: 1 }];
  }
  const home = (i: 0 | 1) => starts[i].reduce((a, b) => (b.share > a.share ? b : a));
  const s0 = sideSnapshot(data, bc, 0, home(0), warnings), s1 = sideSnapshot(data, bc, 1, home(1), warnings);
  const opts: SimOptions = {
    mode: isBattle ? 'battle' : 'war',
    terrainOverride: isBattle ? T[bc.terrain] : undefined,
    starts,
    postures: [bc.sides[0].posture, bc.sides[1].posture],
    fortified: [!!bc.sides[0].fortified, !!bc.sides[1].fortified],
    prepared: [!!bc.sides[0].prepared, !!bc.sides[1].prepared],
    unprepared: [bc.sides[0].prepared === false, bc.sides[1].prepared === false],
    riverCrossing: !!bc.riverCrossing,
    surprise: [!!bc.sides[0].surprise, !!bc.sides[1].surprise],
    reinforcements: [0, 1].map((i) => (bc.sides[i].reinforcements ?? []).map((r) => ({ day: r.day, counts: toCounts(r.forces) }))) as SimOptions['reinforcements'],
    objectives: [bc.sides[0].objective ?? null, bc.sides[1].objective ?? null],
    noProduction: true,
    voronoiControl: true,
    unfortifiedCapitals: CASE_CAPITAL_UNFORTIFIED,
  };
  return { data: { ...data, snapshots: [...data.snapshots, s0, s1] }, scenario, opts, warnings };
}

/** `extra` overrides sim options (e.g. breakpointQuantile for a sweep). */
export function runBattleCase(data: EngineData, bc: BattleCase, seed: number, extra: Partial<SimOptions> = {}): BattleCaseResult {
  const { data: d2, scenario, opts, warnings } = battleCaseScenario(data, bc, seed);
  const sim = createSim(d2, scenario, { ...opts, ...extra });
  const r = runToEnd(sim);
  return {
    winner: r.winner,
    durationDays: r.endDay,
    losses: [r.stats[0].casualties, r.stats[1].casualties],
    result: r,
    warnings: [...warnings, ...sim.setup.warnings],
  };
}
