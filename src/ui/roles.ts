// UI-side role table. The engine sends U.role as an index into this order,
// which must match UNIT_ROLES in data-pipeline/schema.ts (the canonical list).
import type { UnitRole } from '../types/schema';

export const ROLE_ORDER: UnitRole[] = [
  'infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light',
  'chariots', 'elephants', 'artillery', 'armor', 'ifv_apc', 'aircraft_fighter',
  'aircraft_strike', 'helicopters', 'drones', 'ships_major', 'ships_minor', 'submarines',
  'missiles', 'air_defense',
];

export const ROLE_LABEL: Record<UnitRole, string> = {
  infantry_line: 'Line infantry', infantry_light: 'Light infantry', missile_infantry: 'Missile infantry',
  cavalry_heavy: 'Heavy cavalry', cavalry_light: 'Light cavalry', chariots: 'Chariots', elephants: 'Elephants',
  artillery: 'Artillery', armor: 'Armor', ifv_apc: 'IFV / APC', aircraft_fighter: 'Fighters',
  aircraft_strike: 'Strike aircraft', helicopters: 'Helicopters', drones: 'Drones', ships_major: 'Major warships',
  ships_minor: 'Minor warships', submarines: 'Submarines', missiles: 'Missile launchers', air_defense: 'Air defence',
};

/** Icon era band from weapons tech: 0 = pre-gunpowder (<5), 1 = musket era (5..7), 2 = NATO-style (>=7). */
export function eraBand(tech: number): 0 | 1 | 2 {
  if (!(tech >= 5)) return 0;
  return tech >= 7 ? 2 : 1;
}

export const STATUS_LABEL = ['Idle', 'Moving', 'Engaged', 'Routing', 'Besieging', 'Garrison', 'Embarked', 'Destroyed'];
