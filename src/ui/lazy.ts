// Lazy loading. Phase 3 derived snapshots: snapshots.json holds the researched and auto-base
// snapshots; the ~900 Phase 3 ones live in one file per era and are fetched the first time a
// user picks, compares, edits or loads a scenario with one of them. Engine assets: the files only
// a run needs are fetched right after the first screen, and a run started before they are in
// waits for them.
import type { Scenario } from '../types/scenario';
import type { EraId } from '../types/schema';
import { fetchEngineAssets, fetchPhase3Era, mergeEngineAssets, mergePhase3 } from './data';
import { store, toast } from './store';

let assets: Promise<void> | null = null;

/** Fetch the engine assets once and merge them into the store's data. A failed file is listed in
 *  data.missing like any other, so a run then reports it instead of waiting forever. */
export function ensureEngineAssets(): Promise<void> {
  if (!store.get().data) return Promise.resolve();
  assets ??= (async () => {
    const missing: string[] = [];
    let a;
    try { a = await fetchEngineAssets(missing); }
    catch { a = { doctrines: [], terrain: null, climate: null, notes: {}, borders: {} }; missing.push('engine assets'); }
    const d = store.get().data;
    if (d) store.set({ data: mergeEngineAssets(d, a, missing) });
  })();
  return assets;
}

const deferred: Record<string, number> = {};

/** True when the engine assets are in (or there is no data, so the caller reports that). Else
 *  starts loading them and calls `retry` once they are in, unless a later deferral with the same
 *  key replaced this one or `still()` says the request was cancelled meanwhile. A request whose
 *  scenario `s` is no longer the loaded one is dropped through `cancel`: starting it would run a
 *  scenario the user has left (every edit or load makes a new scenario object). */
export function engineAssetsReady(key: 'run' | 'mc', s: Scenario, retry: () => void, still: () => boolean, cancel: () => void): boolean {
  const d = store.get().data;
  if (!d || d.assetsLoaded) return true;
  const n = (deferred[key] = (deferred[key] ?? 0) + 1);
  void ensureEngineAssets().then(() => {
    if (deferred[key] !== n || !still()) return;
    if (store.get().scenario === s) { retry(); return; }
    cancel();
    toast(`${key === 'run' ? 'Run' : 'Monte Carlo'} not started: the scenario changed while the engine loaded.`);
  });
  return false;
}

const inFlight = new Map<EraId, Promise<void>>();

function loadEra(era: EraId): Promise<void> {
  let p = inFlight.get(era);
  if (!p) {
    p = fetchPhase3Era(era)
      .then((snaps) => {
        const d = store.get().data;
        if (d) store.set({ data: mergePhase3(d, era, snaps) });
      })
      .catch((e) => {
        inFlight.delete(era);
        toast(`Could not load Phase 3 ${era} snapshots: ${(e as Error).message}`);
      });
    inFlight.set(era, p);
  }
  return p;
}

/** Make sure every id is loaded; Phase 3 ids pull in their era file. Resolves true when all
 *  ids are available afterwards (unknown ids stay unknown). */
export async function ensureSnapshots(ids: string[]): Promise<boolean> {
  const d = store.get().data;
  if (!d) return false;
  const eras = new Set<EraId>();
  for (const id of ids) {
    if (d.snapById.has(id)) continue;
    const e = d.phase3ById.get(id);
    if (e && !d.phase3Loaded.includes(e.era)) eras.add(e.era);
  }
  await Promise.all([...eras].map(loadEra));
  const nd = store.get().data;
  return !!nd && ids.every((id) => nd.snapById.has(id));
}
