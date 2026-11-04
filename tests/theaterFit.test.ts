import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/types/schema';
import type { Scenario } from '../src/types/scenario';
import { defaultScenario, type BBox } from '../src/ui/scenarioDefaults';
import { fitTheater, refitTheater } from '../src/ui/theaterFit';

const snap = (id: string, lon: number, lat: number, places: [number, number][] = []) => ({
  id, capital: { name: id, lon, lat }, places: places.map(([o, a], i) => ({ name: `${id}${i}`, lon: o, lat: a })),
}) as unknown as Snapshot;

// Constantinople with Gallipoli near it, Milan (1,600 km) and Londinium (2,500 km) far; Bern alone
const rome = snap('rome', 28.98, 41.01, [[9.19, 45.46], [-0.13, 51.5], [26.5, 40.2]]);
const swiss = snap('swiss', 7.45, 46.95);
const byId = new Map([rome, swiss].map((s) => [s.id, s]));
const IBERIA: BBox = [-10, 35, 4, 44];
const scn = (a: string[], b: string[], bbox: BBox = IBERIA): Scenario => {
  const s = defaultScenario();
  s.sides[0].members = a; s.sides[1].members = b; s.theater = { name: 'Iberia', bbox };
  return s;
};

describe('theater fit', () => {
  it('covers both capitals and only the places near their own capital', () => {
    const [w, s, e, n] = fitTheater([rome, swiss])!;
    expect(w).toBeLessThanOrEqual(7.45 - 2);
    expect(e).toBeGreaterThanOrEqual(28.98 + 2);
    expect(s).toBeLessThanOrEqual(40.2 - 2);
    expect(n).toBeGreaterThanOrEqual(46.95 + 2);
    // Londinium is 750 km from Bern but 2,500 km from its own capital, so the box stops short of Britain
    expect(n).toBeLessThan(51.5);
    expect(w).toBeGreaterThan(-0.13);
    for (const v of [w, s, e, n]) expect(v * 4).toBe(Math.round(v * 4));
  });

  it('grows a one-city box to the minimum size and stays inside the world limits', () => {
    const [w, s, e, n] = fitTheater([swiss])!;
    expect(e - w).toBeGreaterThanOrEqual(8);
    expect(n - s).toBeGreaterThanOrEqual(6);
    const [w2, , , n2] = fitTheater([snap('edge', -179.5, 74.5)])!;
    expect(w2).toBe(-180);
    expect(n2).toBe(75);
    expect(fitTheater([])).toBeNull();
  });

  it('moves the box when a new member has its capital outside, and only then', () => {
    // swapping Spain for the Swiss: Bern is outside the Iberia box
    expect(refitTheater(scn(['rome'], ['spain']), scn(['rome'], ['swiss']), byId)).toEqual(fitTheater([rome, swiss]));
    // same members, other edits: a box the user chose stays
    expect(refitTheater(scn(['rome'], ['swiss']), scn(['rome'], ['swiss']), byId)).toBeNull();
    // a new member whose capital is already inside keeps the box
    const wide: BBox = [-12, 34, 45, 62];
    expect(refitTheater(scn(['rome'], [], wide), scn(['rome'], ['swiss'], wide), byId)).toBeNull();
    // removing a member never moves it
    expect(refitTheater(scn(['rome'], ['swiss']), scn(['rome'], []), byId)).toBeNull();
  });
});
