import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/types/schema';
import type { Scenario } from '../src/types/scenario';
import { defaultScenario, type BBox } from '../src/ui/scenarioDefaults';
import { aroundName, fitChoices, fitSides, fitTheater, FITTED_THEATER, refitTheater } from '../src/ui/theaterFit';

const snap = (id: string, lon: number, lat: number, places: [number, number][] = []) => ({
  id, capital: { name: id, lon, lat }, places: places.map(([o, a], i) => ({ name: `${id}${i}`, lon: o, lat: a })),
}) as unknown as Snapshot;

// Constantinople with Gallipoli near it, Milan (1,600 km) and Londinium (2,500 km) far; Bern alone
const rome = snap('rome', 28.98, 41.01, [[9.19, 45.46], [-0.13, 51.5], [26.5, 40.2]]);
const swiss = snap('swiss', 7.45, 46.95);
const usa = snap('usa', -77.04, 38.9, [[-74.0, 40.7], [-76.3, 36.85]]);
const china = snap('china', 116.4, 39.9, [[121.47, 31.23], [117.2, 39.13]]);
const byId = new Map([rome, swiss, usa, china].map((s) => [s.id, s]));
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
    expect(refitTheater(scn(['rome'], ['spain']), scn(['rome'], ['swiss']), byId)).toEqual({ bbox: fitTheater([rome, swiss]), name: FITTED_THEATER, around: null });
    // same members, other edits: a box the user chose stays
    expect(refitTheater(scn(['rome'], ['swiss']), scn(['rome'], ['swiss']), byId)).toBeNull();
    // a new member whose capital is already inside keeps the box
    const wide: BBox = [-12, 34, 45, 62];
    expect(refitTheater(scn(['rome'], [], wide), scn(['rome'], ['swiss'], wide), byId)).toBeNull();
    // removing a member never moves it
    expect(refitTheater(scn(['rome'], ['swiss']), scn(['rome'], []), byId)).toBeNull();
  });

  it('keeps the box when an existing nation only changes its year', () => {
    // Argentina vs UK 1982: London is outside the South Atlantic box on purpose. Picking another
    // UK year used to count as a new member and moved the war away from the Falklands.
    const inNation = (s: Snapshot, id: string, nationId: string) => ({ ...s, id, nationId }) as Snapshot;
    const arg = inNation(snap('', -58.38, -34.6), 'argentina-1982', 'argentina');
    const uk82 = inNation(snap('', -0.13, 51.5), 'uk-1982', 'uk');
    const uk41 = inNation(snap('', -0.13, 51.5), 'uk-1941', 'uk');
    const ids = new Map([arg, uk82, uk41].map((s) => [s.id, s]));
    const falklands: BBox = [-72, -56, -50, -38];
    const before = scn(['argentina-1982'], ['uk-1982'], falklands);
    expect(refitTheater(before, scn(['argentina-1982'], ['uk-1941'], falklands), ids)).toBeNull();
    // a different nation with its capital outside still moves it
    const withSwiss = new Map([...ids, ['swiss', swiss]]);
    expect(refitTheater(before, scn(['argentina-1982'], ['uk-1941', 'swiss'], falklands), withSwiss)).not.toBeNull();
  });

  it('puts the war around one side when the capitals are an ocean apart', () => {
    // Washington to Beijing: one box over both ran across the Atlantic and Eurasia
    const sc = scn(['usa'], ['china']);
    sc.sides[0].name = 'United States'; sc.sides[1].name = 'China';
    const fit = refitTheater(scn(['usa'], ['spain']), sc, byId)!;
    expect(fit).toEqual({ bbox: fitTheater([china]), name: aroundName('China'), around: 1 });
    expect(fit.bbox[0]).toBeGreaterThan(100);
    // both choices are offered, and a box already around side A stays there on the next change
    expect(fitChoices(sc, byId).map((f) => f.name)).toEqual([aroundName('United States'), aroundName('China')]);
    const aroundA = { ...sc, theater: { name: aroundName('United States'), bbox: fitTheater([usa])! } };
    const added = { ...aroundA, sides: [aroundA.sides[0], { ...aroundA.sides[1], members: ['china', 'rome'] }] as typeof sc.sides };
    expect(refitTheater(aroundA, added, byId)).toBeNull();
    // close capitals keep a single box around both
    expect(fitChoices(scn(['rome'], ['swiss']), byId).map((f) => f.around)).toEqual([null]);
  });

  it('puts the war at the home of the side with clearly less ocean-going lift', () => {
    const fleet = (s: Snapshot, major: number) => ({ ...s, military: { forces: { ships_major: { count: { mid: major } } } } }) as unknown as Snapshot;
    // the side that can ship an army comes over; the other side is fought at home
    expect(fitSides([[fleet(usa, 0)], [fleet(china, 100)]], ['A', 'B'])!.around).toBe(0);
    expect(fitSides([[fleet(usa, 100)], [fleet(china, 0)]], ['A', 'B'])!.around).toBe(1);
    // an even match (within 1.5x) goes to side B
    expect(fitSides([[fleet(usa, 80)], [fleet(china, 100)]], ['A', 'B'])!.around).toBe(1);
  });
});

