// Tiny external store (useSyncExternalStore). Per-frame unit data never goes
// through here: frames go straight to the map via `bus` to avoid re-rendering React.
import { useSyncExternalStore } from 'react';
import type { MonteCarloResult, RunResult, SideStats, TheaterInfo } from '../engine/protocol';
import type { Scenario } from '../types/scenario';
import type { AppData } from './data';
import { defaultScenario } from './scenarioDefaults';

export type LeftTab = 'scenario' | 'nations' | 'editor' | 'presets';
export type RightTab = 'live' | 'events' | 'result' | 'montecarlo';
export type MapMode = { kind: 'none' } | { kind: 'bbox'; first?: [number, number] } | { kind: 'start'; side: 0 | 1 };

export interface LayerToggles {
  tilt: boolean;
  terrain3d: boolean;
  hillshade: boolean;
  landcover: boolean;
  rivers: boolean;
  borders: boolean;
  control: boolean;
  supply: boolean;
  fog: boolean;
  fogSide: 0 | 1;
  engineTerrain: boolean;
  stress: boolean;
}

export interface RunState {
  status: 'idle' | 'starting' | 'running' | 'ended' | 'error';
  engineError: string | null;
  theater: TheaterInfo | null;
  sideNames: [string, string];
  warnings: string[];
  speed: number;
  day: number;
  maxDay: number;
  date: string;
  stats: [SideStats, SideStats] | null;
  result: RunResult | null;
  historyVersion: number;
  eventsVersion: number;
}

export interface McState {
  status: 'idle' | 'running' | 'done' | 'error';
  done: number;
  total: number;
  result: MonteCarloResult | null;
  error: string | null;
}

export interface UiState {
  data: AppData | null;
  scenario: Scenario;
  scenarioDirty: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
  leftOpen: boolean;
  showLimits: boolean;
  editorSnapshot: string | null;
  compare: [string | null, string | null];
  mapMode: MapMode;
  layers: LayerToggles;
  run: RunState;
  mc: McState;
  toast: string | null;
}

type Listener = () => void;

function createStore<T extends object>(init: T) {
  let state = init;
  const ls = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      ls.forEach((l) => l());
    },
    subscribe(l: Listener) { ls.add(l); return () => { ls.delete(l); }; },
  };
}

export const initialRun: RunState = {
  status: 'idle', engineError: null, theater: null, sideNames: ['Side A', 'Side B'], warnings: [],
  speed: 0, day: 0, maxDay: 0, date: '', stats: null, result: null, historyVersion: 0, eventsVersion: 0,
};

export const store = createStore<UiState>({
  data: null,
  scenario: defaultScenario(),
  scenarioDirty: false,
  leftTab: 'scenario',
  rightTab: 'live',
  leftOpen: true,
  showLimits: false,
  editorSnapshot: null,
  compare: [null, null],
  mapMode: { kind: 'none' },
  layers: {
    tilt: false, terrain3d: false, hillshade: true, landcover: false, rivers: true, borders: true,
    control: true, supply: true, fog: false, fogSide: 0, engineTerrain: false, stress: false,
  },
  run: initialRun,
  mc: { status: 'idle', done: 0, total: 0, result: null, error: null },
  toast: null,
});

export function useStore<U>(sel: (s: UiState) => U): U {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export function setScenario(f: (s: Scenario) => Scenario) {
  store.set((st) => ({ scenario: f(st.scenario), scenarioDirty: true }));
}
export function setRun(p: Partial<RunState>) { store.set((s) => ({ run: { ...s.run, ...p } })); }
export function setMc(p: Partial<McState>) { store.set((s) => ({ mc: { ...s.mc, ...p } })); }
export function setLayers(p: Partial<LayerToggles>) { store.set((s) => ({ layers: { ...s.layers, ...p } })); }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  store.set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store.set({ toast: null }), 4000);
}
