// Actions on a snapshot shared by the Nations tab, the detail view and the side pickers, and
// the Nations tab's search state, kept here so it survives switching tabs (the panel unmounts).
import type { EraId, Grade, RegionId } from '../../types/schema';
import { ensureSnapshots } from '../lazy';
import type { SnapKind } from '../nationSearch';
import { setScenario, store, toast } from '../store';

export function addMember(side: 0 | 1, id: string) {
  let added = '';
  setScenario((sc) => {
    if (sc.sides.some((s) => s.members.includes(id))) { toast('Already in the scenario.'); return sc; }
    const sides = [...sc.sides] as typeof sc.sides;
    sides[side] = { ...sides[side], members: [...sides[side].members, id] };
    added = sides[side].name;
    return { ...sc, sides };
  });
  // the button that was pressed disables itself, so say where the nation went
  if (added) toast(`Added ${store.get().data?.snapById.get(id)?.name ?? id} to ${added}.`);
}

/** Take a snapshot off whichever side has it. */
export function removeMember(id: string) {
  setScenario((sc) => {
    if (!sc.sides.some((s) => s.members.includes(id))) return sc;
    return { ...sc, sides: sc.sides.map((s) => ({ ...s, members: s.members.filter((m) => m !== id) })) as typeof sc.sides };
  });
}

/** Run an action on a snapshot once it is loaded (Phase 3 eras load on first use). */
export function withSnap(id: string, f: () => void) {
  ensureSnapshots([id]).then((ok) => { if (ok) f(); else toast(`Snapshot ${id} could not be loaded.`); });
}

export function addToSide(side: 0 | 1, id: string) {
  withSnap(id, () => addMember(side, id));
}

export function setCompare(i: 0 | 1, id: string) {
  withSnap(id, () => {
    const c: [string | null, string | null] = [...store.get().compare];
    c[i] = id;
    store.set({ compare: c });
  });
}

export function openInEditor(id: string) {
  withSnap(id, () => store.set({ leftTab: 'editor', editorSnapshot: id }));
}

export interface BrowserState {
  q: string;
  era: EraId | '';
  region: RegionId | '';
  kind: SnapKind | '';
  minGrade: Grade | '';
  /** Snapshot whose detail is open. */
  openId: string | null;
}

/** The Nations tab's search, filters and open detail; module state rather than store state
 *  because nothing else reads it. */
export const browser: BrowserState = { q: '', era: '', region: '', kind: '', minGrade: '', openId: null };

/** Switch to the Nations tab with `q` searched and filters cleared, optionally with one
 *  snapshot's detail open. */
export function showInNations(q: string, openId: string | null = null) {
  Object.assign(browser, { q, era: '', region: '', kind: '', minGrade: '', openId });
  store.set({ leftTab: 'nations', leftOpen: true });
}
