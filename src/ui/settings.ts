// Viewer preferences: how the map and runs look in this browser. Stored per browser only, like the
// theme, so they never travel in a shared scenario and never change what the engine computes.
import { useSyncExternalStore } from 'react';

export type Basemap = 'relief' | 'muted' | 'dark';
export type UnitSize = 'small' | 'normal' | 'large';

export interface Settings {
  /** Shading of the relief imagery under the war layers. */
  basemap: Basemap;
  /** Scale of the unit symbols on the map. */
  unitSize: UnitSize;
  /** Days per second a new run starts at (the time bar's named speeds). */
  startSpeed: 1 | 3 | 30;
  /** Keep the map layer toggles between visits. */
  rememberLayers: boolean;
}

export const DEFAULT_SETTINGS: Settings = { basemap: 'relief', unitSize: 'normal', startSpeed: 3, rememberLayers: true };

export const BASEMAPS: [Basemap, string, string][] = [
  ['relief', 'Relief', 'NASA Blue Marble shaded relief, as is'],
  ['muted', 'Muted', 'Greyed relief, so the front and the units stand out'],
  ['dark', 'Dark', 'Dimmed relief for a dark room or the dark theme'],
];
export const UNIT_SIZES: [UnitSize, string][] = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];
export const START_SPEEDS: [Settings['startSpeed'], string][] = [[1, 'Slow'], [3, 'Normal'], [30, 'Fast']];

/** Unit symbol scale factor per size setting. */
export const UNIT_SCALE: Record<UnitSize, number> = { small: 0.8, normal: 1, large: 1.3 };

/** MapLibre raster paint for the relief layer per basemap. */
export const BASEMAP_PAINT: Record<Basemap, { saturation: number; brightnessMax: number; contrast: number }> = {
  relief: { saturation: -0.1, brightnessMax: 1, contrast: 0.05 },
  muted: { saturation: -0.85, brightnessMax: 0.8, contrast: -0.1 },
  dark: { saturation: -0.4, brightnessMax: 0.38, contrast: 0.1 },
};

const KEY = 'mews.settings';
const LAYERS_KEY = 'mews.layers';

const pick = <T>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);

/** Settings from storage, each field checked: a value from an older build or a hand edit falls back
 *  to its default instead of reaching the map. */
function read(): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch { /* storage blocked or corrupt: defaults */ }
  const d = DEFAULT_SETTINGS;
  return {
    basemap: pick(raw.basemap, BASEMAPS.map(([k]) => k), d.basemap),
    unitSize: pick(raw.unitSize, UNIT_SIZES.map(([k]) => k), d.unitSize),
    startSpeed: pick(raw.startSpeed, START_SPEEDS.map(([k]) => k), d.startSpeed),
    rememberLayers: typeof raw.rememberLayers === 'boolean' ? raw.rememberLayers : d.rememberLayers,
  };
}

let current: Settings = typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : read();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: not remembered */ }
  if (patch.rememberLayers === false) { try { localStorage.removeItem(LAYERS_KEY); } catch { /* nothing stored */ } }
  listeners.forEach((l) => l());
}

export function resetSettings(): void {
  try { localStorage.removeItem(LAYERS_KEY); } catch { /* nothing stored */ }
  setSettings(DEFAULT_SETTINGS);
}

export function subscribeSettings(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
}

/** Saved layer toggles merged over the defaults, keeping only known boolean keys (and fogSide), so a
 *  stored copy from an older build cannot add or break a layer. Null when nothing is remembered. */
export function readSavedLayers<T extends object>(defaults: T): T | null {
  if (!current.rememberLayers) return null;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
    for (const [k, d] of Object.entries(defaults)) {
      // the stress test is a developer switch, not a viewing preference
      if (k === 'stress') continue;
      const s = (v as Record<string, unknown>)[k];
      if (typeof d === 'boolean' && typeof s === 'boolean') out[k] = s;
      else if (k === 'fogSide' && (s === 0 || s === 1)) out[k] = s;
    }
    return out as T;
  } catch { return null; }
}

export function saveLayers(layers: object): void {
  if (!current.rememberLayers) return;
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch { /* private mode: not remembered */ }
}
