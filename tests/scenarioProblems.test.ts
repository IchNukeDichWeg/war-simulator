import { afterEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/types/schema';
import type { Scenario } from '../src/types/scenario';
import type { AppData } from '../src/ui/data';
import { scenarioProblems } from '../src/ui/engine';
import { defaultScenario } from '../src/ui/scenarioDefaults';
import { store } from '../src/ui/store';
import { swapMembers } from '../src/ui/panels/ScenarioBuilder';

// Review findings: a scenario the engine cannot run (or runs as nonsense) kept Run enabled.
const snaps = [['rome-117', 'rome'], ['rome-395', 'rome'], ['spain-2026', 'spain'], ['france-1939', 'france']]
  .map(([id, nationId]) => ({ id, nationId, name: id }) as unknown as Snapshot);
const withData = () => store.set({ data: { snapById: new Map(snaps.map((s) => [s.id, s])) } as unknown as AppData });

const scn = (a: string[], b: string[]): Scenario => {
  const s = defaultScenario();
  s.sides[0].name = 'Rome'; s.sides[0].members = a;
  s.sides[1].name = 'Spain'; s.sides[1].members = b;
  return s;
};

describe('scenario problems', () => {
  afterEach(() => { store.set({ data: null }); });

  it('a plain two-sided scenario has none', () => {
    withData();
    expect(scenarioProblems(scn(['rome-117'], ['spain-2026']))).toEqual([]);
  });

  it('flags the same snapshot on both sides or twice on one side', () => {
    // the engine fought Rome against itself and ended on day 2
    withData();
    expect(scenarioProblems(scn(['rome-117'], ['rome-117'])).join(' ')).toMatch(/rome-117.*both sides/);
    expect(scenarioProblems(scn(['rome-117', 'rome-117'], ['spain-2026'])).join(' ')).toMatch(/rome-117.*twice/);
    // two years of one nation are two snapshots, and allowed
    expect(scenarioProblems(scn(['rome-117'], ['rome-395']))).toEqual([]);
  });
});

describe('swapping a member for another year', () => {
  it('refuses a snapshot that is already in the scenario', () => {
    const sides = scn(['rome-117'], ['rome-395']).sides;
    // the year picker on side A choosing 395, which side B already has
    expect(swapMembers(sides, 0, (id) => (id === 'rome-117' ? 'rome-395' : id))).toEqual({ members: ['rome-117'], refused: ['rome-395'] });
    // "Set side year" mapping two members of one side onto the same snapshot keeps the second
    const one = scn(['rome-117', 'rome-395'], ['spain-2026']).sides;
    expect(swapMembers(one, 0, () => 'rome-395')).toEqual({ members: ['rome-117', 'rome-395'], refused: ['rome-395'] });
    // a free snapshot is taken
    expect(swapMembers(sides, 1, () => 'france-1939')).toEqual({ members: ['france-1939'], refused: [] });
  });
});
