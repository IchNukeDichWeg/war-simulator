// The theater box follows the nations picked. Swapping a member used to leave the box where the
// preset put it, so a new member's capital could sit hundreds of km outside (Bern outside the
// Iberia box): its army then marched in at the edge and the other side starved on a supply line
// to a capital beyond reach, which made the run meaningless.
import type { Scenario } from '../types/scenario';
import type { Place, Snapshot } from '../types/schema';
import type { BBox } from './scenarioDefaults';

export const FITTED_THEATER = 'Fitted to the sides';

/** A member's places this far from its own capital count towards the box. A fixed radius:
 *  it keeps an empire's far provinces (Roman Britain against the Swiss) out of a war that is
 *  fought between the capitals; the upgrade would be the members' border polygons. Measured
 *  from the enemy capital too, Londinium (750 km from Bern) would stretch the box over Britain. */
const NEAR_KM = 1000;
/** Margin around the points, and the smallest box, in degrees. */
const PAD_DEG = 2;
const MIN_SPAN: [number, number] = [8, 6];

function km(a: Place, b: Place): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Box around every member's capital and its places near that capital, padded and snapped
 *  outward to the engine's 0.25 degree grid. Null when there is no member. */
export function fitTheater(snaps: Snapshot[]): BBox | null {
  if (snaps.length === 0) return null;
  const pts = snaps.flatMap((s) => [s.capital, ...s.places.filter((p) => km(p, s.capital) <= NEAR_KM)]);
  let w = Math.min(...pts.map((p) => p.lon)) - PAD_DEG, e = Math.max(...pts.map((p) => p.lon)) + PAD_DEG;
  let s = Math.min(...pts.map((p) => p.lat)) - PAD_DEG, n = Math.max(...pts.map((p) => p.lat)) + PAD_DEG;
  const grow = (lo: number, hi: number, min: number): [number, number] => (hi - lo >= min ? [lo, hi] : [(lo + hi - min) / 2, (lo + hi + min) / 2]);
  [w, e] = grow(w, e, MIN_SPAN[0]);
  [s, n] = grow(s, n, MIN_SPAN[1]);
  const q = (v: number, up: boolean) => (up ? Math.ceil(v * 4) : Math.floor(v * 4)) / 4;
  // the World preset's limits: the scenario box is not antimeridian-aware
  return [Math.max(-180, q(w, false)), Math.max(-60, q(s, false)), Math.min(180, q(e, true)), Math.min(75, q(n, true))];
}

const inside = (p: Place, [w, s, e, n]: BBox) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;

/** After an edit, the box to switch to, or null to keep the current one. It moves only when a
 *  member that was not in the scenario before has its capital outside the box, so a box the
 *  user chose (or a preset that keeps a capital outside on purpose) survives year changes and
 *  additions that fit. */
export function refitTheater(before: Scenario, after: Scenario, snapById: Map<string, Snapshot>): BBox | null {
  const old = new Set(before.sides.flatMap((x) => x.members));
  const added = after.sides.flatMap((x) => x.members).filter((m) => !old.has(m));
  const box = after.theater.bbox as BBox;
  if (!added.some((m) => { const s = snapById.get(m); return s && !inside(s.capital, box); })) return null;
  return fitTheater(after.sides.flatMap((x) => x.members).map((m) => snapById.get(m)).filter((s): s is Snapshot => !!s));
}
