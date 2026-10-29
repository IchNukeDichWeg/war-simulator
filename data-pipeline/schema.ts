// JSON Schemas for raw research output. Mirrors src/types/schema.ts and
// src/types/mechanics.ts; the pipeline rejects any raw file that fails these.
// Cross-field rules (low <= mid <= high, fractions in 0..1, force accounting,
// id/year/era consistency) are checked in validate.ts.

const grade = { enum: ['A', 'B', 'C', 'D'] };

/** URL, printed work (isbn:/doi:, page in the note) or documented derivation. */
export const SOURCE_PATTERN = '^(https?://\\S+|isbn:[0-9Xx-]{10,17}|doi:10\\.\\S+|derived:[a-z0-9-]+)$';

export const estSchema = {
  type: 'object',
  required: ['low', 'mid', 'high', 'grade', 'source', 'note'],
  additionalProperties: false,
  properties: {
    low: { type: 'number' },
    mid: { type: 'number' },
    high: { type: 'number' },
    grade,
    source: { type: 'string', pattern: SOURCE_PATTERN },
    note: { type: 'string' },
  },
};

const est = { $ref: '#/$defs/est' };

export const UNIT_ROLES = [
  'infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light',
  'chariots', 'elephants', 'artillery', 'armor', 'ifv_apc', 'aircraft_fighter',
  'aircraft_strike', 'helicopters', 'drones', 'ships_major', 'ships_minor', 'submarines',
  'missiles', 'air_defense',
] as const;

export const TECH_CATEGORIES = [
  'weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber',
] as const;

export const ERAS = ['bronze', 'iron', 'medieval', 'gunpowder', 'industrial', 'worldwars', 'coldwar', 'modern'] as const;
export const REGIONS = [
  'europe', 'mena', 'subsaharan_africa', 'central_asia', 'south_asia', 'east_asia',
  'southeast_asia', 'north_america', 'latin_america', 'oceania',
] as const;
export const TERRAIN = ['water', 'plains', 'cropland', 'forest', 'hills', 'mountains', 'desert', 'steppe', 'wetland', 'urban', 'ice'] as const;

export const SPECIALS = [
  'feigned_retreat', 'field_fortification', 'corps_system', 'deep_battle', 'blitzkrieg',
  'joint_air_land', 'guerrilla', 'scorched_earth', 'naval_focus', 'horse_archery',
  'phalanx', 'siege_engineering', 'levee_en_masse', 'human_wave', 'defense_in_depth',
  'amphibious', 'strategic_bombing', 'precision_strike', 'massed_artillery', 'mission_command',
] as const;

export const DOCTRINE_WEIGHTS = [
  'aggression', 'maneuver', 'flanking', 'siegePreference', 'reserveUse', 'scouting',
  'retreatThreshold', 'combinedArms', 'initiative', 'logisticsDiscipline',
] as const;

const place = {
  type: 'object',
  required: ['name', 'lat', 'lon'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lon: { type: 'number', minimum: -180, maximum: 180 },
    kind: { enum: ['capital', 'city', 'fortress', 'port', 'chokepoint'] },
    population: { type: 'number', minimum: 0 },
  },
};

const forceEntry = {
  type: 'object',
  required: ['count', 'quality', 'training'],
  additionalProperties: false,
  properties: { count: est, quality: est, training: est },
};

function obj(props: Record<string, unknown>, optional: string[] = []) {
  return {
    type: 'object',
    required: Object.keys(props).filter((k) => !optional.includes(k)),
    additionalProperties: false,
    properties: props,
  };
}

const roleMap = (v: unknown) => ({
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(UNIT_ROLES.map((r) => [r, v])),
});
const sources = {
  type: 'array', minItems: 1,
  items: obj({ title: { type: 'string' }, url: { type: 'string', pattern: SOURCE_PATTERN } }),
};

export const snapshotSchema = {
  $id: 'snapshot',
  $defs: { est: estSchema },
  ...obj({
    id: { type: 'string', pattern: '^[a-z0-9-]+-(-)?[1-9][0-9]*$' },
    nationId: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    includes: { type: 'array', items: { type: 'string' } },
    name: { type: 'string' },
    year: { type: 'integer', minimum: -3000, maximum: 2026, not: { const: 0 } },
    era: { enum: ERAS },
    region: { enum: REGIONS },
    phase: { enum: ['rise', 'peak', 'decline', 'current', 'key'] },
    tags: { type: 'array', items: { type: 'string' } },
    capital: place,
    places: { type: 'array', items: place },
    territory: obj({ border: { type: 'string' }, areaKm2: est }),
    demography: obj({ population: est, urbanization: est }),
    military: obj({
      activePersonnel: est,
      trainedReserves: est,
      supportPersonnel: est,
      mobilizationRatio: est,
      mobilizable: est,
      forces: roleMap(forceEntry),
      commandQuality: est,
      cohesion: est,
      morale: est,
    }),
    tech: obj(Object.fromEntries(TECH_CATEGORIES.map((c) => [c, est]))),
    economy: obj({
      gdpPerCapita: est, gdp: est, milSpendShare: est, industrialShare: est,
      foodSurplus: est, annualCohort: est, production: roleMap(est),
    }),
    logistics: obj({
      roadKm: est, railKm: est, majorPorts: est, merchantTonnage: est,
      supplyRangeKm: est, draftAnimals: est,
    }),
    strategic: obj({ nuclearWarheads: est, basesAbroad: { type: 'array', items: place } }),
    doctrineId: { type: 'string' },
    geography: obj({
      climate: { type: 'string' },
      chokepoints: { type: 'array', items: { type: 'string' } },
      homeDefense: est,
      terrainMix: { type: 'object', additionalProperties: false, properties: Object.fromEntries(TERRAIN.map((t) => [t, { type: 'number', minimum: 0, maximum: 1 }])) },
    }, ['terrainMix']),
    notes: { type: 'string' },
  }),
};

export const doctrineSchema = {
  $id: 'doctrine',
  ...obj({
    id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    name: { type: 'string' },
    appliesTo: { type: 'array', items: { type: 'string' } },
    era: { type: 'array', items: { enum: ERAS }, minItems: 1 },
    archetype: { type: 'boolean' },
    grade,
    weights: obj(Object.fromEntries(DOCTRINE_WEIGHTS.map((k) => [k, { type: 'number', minimum: 0, maximum: 1 }]))),
    weightNotes: obj(Object.fromEntries(DOCTRINE_WEIGHTS.map((k) => [k, { type: 'string', minLength: 5 }]))),
    specials: { type: 'array', items: { enum: SPECIALS } },
    summary: { type: 'string', minLength: 40 },
    whyItWorked: { type: 'string', minLength: 20 },
    whereItFailed: { type: 'string', minLength: 20 },
    sources,
  }),
};

export const coalitionSchema = {
  $id: 'coalition',
  ...obj({
    id: { type: 'string' }, name: { type: 'string' }, year: { type: 'integer' },
    members: { type: 'array', items: { type: 'string' }, minItems: 1 },
    note: { type: 'string' }, sources,
  }),
};

const range = obj({ low: { type: 'number', minimum: 0 }, mid: { type: 'number', minimum: 0 }, high: { type: 'number', minimum: 0 } });
const battleSide = obj({
  name: { type: 'string' },
  posture: { enum: ['attack', 'defend'] },
  snapshotId: { type: 'string' },
  forces: roleMap(range),
  tech: { type: 'object', additionalProperties: false, properties: Object.fromEntries(TECH_CATEGORIES.map((c) => [c, { type: 'number', minimum: 0, maximum: 10 }])) },
  commandQuality: { type: 'number', minimum: 0, maximum: 1 },
  morale: { type: 'number', minimum: 0, maximum: 1 },
  training: { type: 'number', minimum: 0, maximum: 1 },
  doctrineId: { type: 'string' },
  fortified: { type: 'boolean' },
  prepared: { type: 'boolean' },
  surprise: { type: 'boolean' },
  startPositions: { type: 'array', items: obj({ lat: { type: 'number' }, lon: { type: 'number' }, share: { type: 'number' } }) },
  objective: obj({ name: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } }),
  reinforcements: { type: 'array', items: obj({ day: { type: 'number' }, forces: roleMap(range) }) },
  note: { type: 'string' },
}, ['snapshotId', 'tech', 'commandQuality', 'morale', 'training', 'doctrineId', 'fortified', 'prepared', 'surprise', 'startPositions', 'objective', 'reinforcements', 'note']);

export const battleSchema = {
  $id: 'battle',
  ...obj({
    id: { type: 'string' }, name: { type: 'string' }, year: { type: 'integer', not: { const: 0 } },
    kind: { enum: ['battle', 'campaign'] },
    location: obj({ lat: { type: 'number' }, lon: { type: 'number' }, radiusKm: { type: 'number' } }),
    bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
    terrain: { enum: TERRAIN },
    season: { enum: ['spring', 'summer', 'autumn', 'winter'] },
    sides: { type: 'array', items: battleSide, minItems: 2, maxItems: 2 },
    outcome: obj({
      winner: { enum: [0, 1, 'draw'] },
      durationDays: range,
      losses: { type: 'array', items: range, minItems: 2, maxItems: 2 },
      note: { type: 'string' },
    }),
    sources, grade,
  }, ['bbox']),
};

/** Every leaf constant in a mechanics file. */
export const mvSchema = {
  type: 'object',
  required: ['low', 'mid', 'high', 'grade', 'source', 'note'],
  additionalProperties: false,
  properties: {
    low: { type: 'number' }, mid: { type: 'number' }, high: { type: 'number' }, grade,
    source: { type: 'string', pattern: SOURCE_PATTERN }, note: { type: 'string' },
  },
};
