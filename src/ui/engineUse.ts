// Which editable snapshot fields the engine reads (red team W3). Every Est is editable, but the
// engine builds formations from force counts, supply from tech-level mechanics and cities, and so
// on; the fields below are researched context it does not read, or reads only in a narrow case.
// None is wired in: ENGINE.md models none of these quantities from the field (merchant tonnage
// and draft animals have no troops-per-ton or animal constants; roads are cells with places).
// Checked by tests/engineUse.test.ts, which runs the engine with each unused field overridden.

export interface EngineUse { used: false | 'partly'; note: string }

export const ENGINE_USE: Record<string, EngineUse> = {
  'demography.population': { used: 'partly', note: 'Read only to scale a snapshot when a nation it includes is excluded, and for production damage from a nuclear strike on a city.' },
  'demography.urbanization': { used: false, note: 'Not read: supply depots are the snapshot\'s places and the urban land-cover cells of its territory.' },
  'economy.gdp': { used: false, note: 'Not read: there is no economy model; war production comes from the per-role production rates.' },
  'economy.gdpPerCapita': { used: false, note: 'Not read: there is no economy model; war production comes from the per-role production rates.' },
  'economy.milSpendShare': { used: false, note: 'Not read: there is no economy model; war production comes from the per-role production rates.' },
  'economy.industrialShare': { used: false, note: 'Not read: there is no economy model; war production comes from the per-role production rates.' },
  'economy.foodSurplus': { used: false, note: 'Not read: food comes from supply sources and forage, not national food production.' },
  'logistics.roadKm': { used: false, note: 'Not read: roads are modelled as the cells of own places; the road bonus and depot throughput come from logistics tech.' },
  'logistics.railKm': { used: 'partly', note: 'Only whether it is above 0 is read: any rail adds the rail throughput to every own depot.' },
  'logistics.majorPorts': { used: false, note: 'Not read: ports are the snapshot\'s places of kind port and its coastal places.' },
  'logistics.merchantTonnage': { used: false, note: 'Not read: sea lift is troop lift per warship x ships (no troops-per-ton constant).' },
  'logistics.draftAnimals': { used: false, note: 'Not read: animals with the army come from animals per 1000 troops at the logistics tech level.' },
  'military.activePersonnel': { used: 'partly', note: 'Read only to size the recruit pool (mobilizable minus active minus reserves); the fielded army comes from the force composition counts.' },
  'military.supportPersonnel': { used: false, note: 'Not read: the fielded army is the personnel of the force composition roles.' },
  'military.mobilizationRatio': { used: false, note: 'Not read: the recruit cap is the mobilizable field.' },
  'territory.areaKm2': { used: 'partly', note: 'Read only for a snapshot without a border polygon, whose territory becomes a disc of this area around the capital.' },
};

/** Engine use of an Editor field path (no ".mid"); undefined when the engine reads it in every run. */
export function engineUse(path: string): EngineUse | undefined {
  return ENGINE_USE[path];
}
