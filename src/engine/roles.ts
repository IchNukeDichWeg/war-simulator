// Canonical role order used by the engine and by Frame.units[U.role].
// The UI maps the role index back to a UnitRole with ROLES[i].
import type { UnitRole } from '../types/schema';

export const ROLES: UnitRole[] = [
  'infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light',
  'chariots', 'elephants', 'artillery', 'armor', 'ifv_apc',
  'aircraft_fighter', 'aircraft_strike', 'helicopters', 'drones',
  'ships_major', 'ships_minor', 'submarines', 'missiles', 'air_defense',
];
export const NR = ROLES.length;
export const RI = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<UnitRole, number>;

/** 1 for personnel (P) roles. */
export const IS_P = new Uint8Array(NR);
for (const r of ['infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light'] as UnitRole[]) IS_P[RI[r]] = 1;

/** Roles that live in map formations (ground forces, incl. missile launchers and air defence). */
export const IS_LAND = new Uint8Array(NR);
for (const r of ['infantry_line', 'infantry_light', 'missile_infantry', 'cavalry_heavy', 'cavalry_light',
  'chariots', 'elephants', 'artillery', 'armor', 'ifv_apc', 'missiles', 'air_defense'] as UnitRole[]) IS_LAND[RI[r]] = 1;

/** Indirect-fire and support roles: fire, but do not manoeuvre or pursue. */
export const IS_SUPPORT_FIRE = new Uint8Array(NR);
for (const r of ['artillery', 'missiles', 'air_defense'] as UnitRole[]) IS_SUPPORT_FIRE[RI[r]] = 1;

export const AIR_ROLES = [RI.aircraft_fighter, RI.aircraft_strike, RI.helicopters, RI.drones];
export const STRIKE_ROLES = [RI.aircraft_strike, RI.helicopters, RI.drones];
export const NAVAL_ROLES = [RI.ships_major, RI.ships_minor, RI.submarines];
export const IS_AIR = new Uint8Array(NR);
for (const r of AIR_ROLES) IS_AIR[r] = 1;
export const IS_NAVAL = new Uint8Array(NR);
for (const r of NAVAL_ROLES) IS_NAVAL[r] = 1;

export const LOSS_CAUSES = ['combat', 'pursuit', 'captured', 'disease', 'starvation', 'exposure', 'desertion', 'air', 'naval', 'nuclear'] as const;
export type LossCauseT = typeof LOSS_CAUSES[number];
export const LC = Object.fromEntries(LOSS_CAUSES.map((c, i) => [c, i])) as Record<LossCauseT, number>;
