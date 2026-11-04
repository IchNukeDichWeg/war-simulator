// The theater box follows the nations picked. Swapping a member used to leave the box where the
// preset put it, so a new member's capital could sit hundreds of km outside (Bern outside the
// Iberia box): its army then marched in at the edge and the other side starved on a supply line
// to a capital beyond reach, which made the run meaningless.
import type { Scenario } from '../types/scenario';
import type { Place, Snapshot } from '../types/schema';
import type { Mechanics } from '../types/mechanics';
import { byTech } from '../engine/mech';
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

/** Capitals farther apart than this get a box around one side only; the engine brings the
 *  other side in over land or by sea lift, as the intercontinental presets do (United States vs
 *  China plays in the Western Pacific). One box over both made a 2,000 km tall strip from
 *  Washington to Beijing across the Atlantic and Eurasia, the long way round, because the box
 *  cannot wrap past 180 degrees. 4,000 km keeps every European and Near East pairing whole
 *  (Bern to Constantinople is 1,700 km, Paris to Moscow 2,500). */
const FAR_KM = 4000;

export interface Fit { bbox: BBox; name: string; around: 0 | 1 | null }
export const aroundName = (sideName: string) => `Around ${sideName}`;

/** Troops a snapshot's ocean-going fleet carries per trip: troopLiftPerShip at its ship tech x
 *  major ships. Minor ships are left out, unlike the engine's sea lift: China 1979's 903 patrol
 *  craft would otherwise outweigh the 2026 US Navy and put that war on the US east coast. */
function seaLift(s: Snapshot, m: Mechanics | null): number {
  const ships = s.military?.forces?.ships_major?.count?.mid ?? 0;
  return m ? byTech(m.naval.troopLiftPerShip, s.tech?.ships?.mid ?? 0) * ships : ships;
}
/** Lift ratios inside this count as even, and the war goes to side B (United States vs China
 *  2026: 122 against 103 major ships, played in the Western Pacific as in the preset). */
const EVEN_LIFT = 1.5;

/** The automatic war area for these sides: around both when their capitals are close, else
 *  around one side: `prefer`, or else the side with clearly less ocean-going lift, since the
 *  side that can ship an army is the one that comes over (Athens against the United States is
 *  fought in Greece, Argentina against the United Kingdom near Argentina, as in the presets).
 *  An even match goes to side B, the side named second in "A vs B". */
export function fitSides(sides: [Snapshot[], Snapshot[]], names: [string, string], prefer?: 0 | 1, m: Mechanics | null = null): Fit | null {
  if (sides[0].length === 0 || sides[1].length === 0) {
    const bbox = fitTheater([...sides[0], ...sides[1]]);
    return bbox && { bbox, name: FITTED_THEATER, around: null };
  }
  const gap = Math.min(...sides[0].flatMap((a) => sides[1].map((b) => km(a.capital, b.capital))));
  if (gap <= FAR_KM) return { bbox: fitTheater([...sides[0], ...sides[1]])!, name: FITTED_THEATER, around: null };
  const lift = sides.map((x) => x.reduce((t, sn) => t + seaLift(sn, m), 0));
  const at: 0 | 1 = prefer ?? (lift[1] > EVEN_LIFT * lift[0] ? 0 : 1);
  return { bbox: fitTheater(sides[at])!, name: aroundName(names[at]), around: at };
}

const sideSnaps = (sc: Scenario, snapById: Map<string, Snapshot>) =>
  sc.sides.map((x) => x.members.map((m) => snapById.get(m)).filter((s): s is Snapshot => !!s)) as [Snapshot[], Snapshot[]];

/** After an edit, the war area to switch to, or null to keep the current one. It moves only
 *  when a member that was not in the scenario before has its capital outside the box, so a box
 *  the user chose (or a preset that keeps a capital outside on purpose) survives year changes
 *  and additions that fit. A box already around one side stays around that side. */
export function refitTheater(before: Scenario, after: Scenario, snapById: Map<string, Snapshot>, m: Mechanics | null = null): Fit | null {
  const old = new Set(before.sides.flatMap((x) => x.members));
  const added = after.sides.flatMap((x) => x.members).filter((m) => !old.has(m));
  const box = after.theater.bbox as BBox;
  if (!added.some((m) => { const s = snapById.get(m); return s && !inside(s.capital, box); })) return null;
  const names = after.sides.map((x) => x.name) as [string, string];
  const prefer = ([0, 1] as const).find((i) => before.theater.name === aroundName(before.sides[i].name));
  const fit = fitSides(sideSnaps(after, snapById), names, prefer, m);
  // the far side's capital is outside by design: nothing to move
  return fit && (fit.bbox.join() !== box.join() || fit.name !== after.theater.name) ? fit : null;
}

/** The fits the Where section offers: one around both sides, or one around each side. */
export function fitChoices(sc: Scenario, snapById: Map<string, Snapshot>): Fit[] {
  const snaps = sideSnaps(sc, snapById);
  const names = sc.sides.map((x) => x.name) as [string, string];
  const a = fitSides(snaps, names, 0);
  if (!a) return [];
  return a.around === null ? [a] : [a, fitSides(snaps, names, 1)!];
}
