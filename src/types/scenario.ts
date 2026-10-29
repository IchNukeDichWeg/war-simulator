// Scenario definition: everything needed to reproduce a run. Saved as JSON and
// encoded into share URLs.
import type { Override } from './schema';

export type TechMode = 'native' | 'equalized' | 'timeslice';

export interface SideSpec {
  name: string;
  color: string;               // hex, used on the map and charts
  /** Snapshot ids fighting on this side. Coalition presets expand to these. */
  members: string[];
  /** Optional per-member share of forces committed to this theater (0..1).
   *  Default: computed by the engine from distance and power projection. */
  commitment?: Record<string, number>;
  /** Optional explicit start positions; default is own cities in the theater
   *  or the theater edge nearest home. */
  startPositions?: { lat: number; lon: number }[];
}

export interface RuleToggles {
  naval: boolean;
  air: boolean;
  weather: boolean;
  supply: boolean;
  fogOfWar: boolean;
  nuclear: boolean;            // off by default; documented escalation model in ENGINE.md
}

export interface VictoryConditions {
  capitalCaptured: boolean;
  territoryShare: number;      // 0 = off; else fraction of the enemy's starting theater territory to hold
  armyCollapse: boolean;
  timeLimitDays: number;
}

export interface Scenario {
  version: 1;
  id: string;
  name: string;
  description: string;
  sides: [SideSpec, SideSpec];
  /** nationIds removed everywhere, including from snapshots that `include` them. */
  excluded: string[];
  techMode: TechMode;
  /** Tech level 0..10 both sides fight at in 'equalized' mode. */
  equalizedTech?: number;
  theater: { name: string; bbox: [number, number, number, number] }; // [west, south, east, north]
  startMonth: number;          // 1..12, sets season
  rules: RuleToggles;
  victory: VictoryConditions;
  seed: number;
  overrides: Override[];
}

export const DEFAULT_RULES: RuleToggles = {
  naval: true, air: true, weather: true, supply: true, fogOfWar: false, nuclear: false,
};

export const DEFAULT_VICTORY: VictoryConditions = {
  capitalCaptured: true, territoryShare: 0.6, armyCollapse: true, timeLimitDays: 730,
};
