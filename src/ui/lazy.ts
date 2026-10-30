// Lazy loading of Phase 3 derived snapshots. snapshots.json holds the researched and auto-base
// snapshots; the ~900 Phase 3 ones live in one file per era and are fetched the first time a
// user picks, compares, edits or loads a scenario with one of them.
import type { EraId } from '../types/schema';
import { fetchPhase3Era, mergePhase3 } from './data';
import { store, toast } from './store';

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
