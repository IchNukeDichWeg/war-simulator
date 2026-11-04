import { describe, expect, it } from 'vitest';
import type { Nation, Snapshot } from '../src/types/schema';
import type { Scenario } from '../src/types/scenario';
import { defaultScenario } from '../src/ui/scenarioDefaults';
import { followNames } from '../src/ui/scenarioNames';

const snaps = [
  ['rome-117', 'rome', 'Roman Empire (Trajan)', 117], ['rome-395', 'rome', 'Roman Empire (Theodosius I)', 395],
  ['spain-2026', 'spain', 'Kingdom of Spain', 2026], ['switzerland-2026', 'switzerland', 'Swiss Confederation', 2026],
  ['germany-1939', 'germany', 'German Reich', 1939], ['italy-1940', 'italy', 'Kingdom of Italy', 1940],
  ['athens--480', 'athens', 'Athens', -480], ['sparta--480', 'sparta', 'Sparta', -480], ['thebes--480', 'thebes', 'Thebes', -480],
].map(([id, nationId, name, year]) => ({ id, nationId, name, year }) as unknown as Snapshot);
const d = { snapById: new Map(snaps.map((s) => [s.id, s])), nationById: new Map<string, Nation>() };

const scn = (title: string, a: [string, string[]], b: [string, string[]]): Scenario => {
  const s = defaultScenario();
  s.name = title;
  s.sides[0].name = a[0]; s.sides[0].members = a[1];
  s.sides[1].name = b[0]; s.sides[1].members = b[1];
  return s;
};

describe('names follow the members', () => {
  it('renames a swapped side and its part of the title, with the new year', () => {
    const before = scn('Roman Empire (117) vs Spain (2026)', ['Roman Empire', ['rome-117']], ['Spain', ['spain-2026']]);
    const after = followNames(before, scn(before.name, ['Roman Empire', ['rome-395']], ['Spain', ['switzerland-2026']]), d);
    expect(after.sides.map((s) => s.name)).toEqual(['Roman Empire', 'Swiss Confederation']);
    expect(after.name).toBe('Roman Empire (395) vs Swiss Confederation (2026)');
  });

  it('keeps names the user typed and coalition names', () => {
    const before = scn('My war', ['Legions', ['rome-117']], ['Hellenic League', ['athens--480', 'sparta--480']]);
    const after = followNames(before, scn('My war', ['Legions', ['rome-395']], ['Hellenic League', ['athens--480', 'sparta--480', 'thebes--480']]), d);
    expect(after.sides.map((s) => s.name)).toEqual(['Legions', 'Hellenic League']);
    expect(after.name).toBe('My war');
  });

  it('adds and drops "and allies" around a name that still fits', () => {
    const one = scn('Germany vs Spain', ['Germany', ['germany-1939']], ['Spain', ['spain-2026']]);
    const two = followNames(one, scn(one.name, ['Germany', ['germany-1939', 'italy-1940']], ['Spain', ['spain-2026']]), d);
    expect(two.sides[0].name).toBe('Germany and allies');
    expect(two.name).toBe('Germany and allies vs Spain');
    const back = followNames(two, scn(two.name, ['Germany and allies', ['germany-1939']], ['Spain', ['spain-2026']]), d);
    expect(back.sides[0].name).toBe('Germany');
    expect(back.name).toBe('Germany vs Spain');
  });

  it('fills a default title and default side names', () => {
    const before = scn('Custom scenario', ['Side A', []], ['Side B', ['spain-2026']]);
    const after = followNames(before, scn('Custom scenario', ['Side A', ['athens--480']], ['Side B', ['spain-2026']]), d);
    expect(after.sides[0].name).toBe('Athens');
    // side B's members did not change, so its default name stays
    expect(after.name).toBe('Athens (480 BCE) vs Side B (2026)');
  });

  it('does nothing when no member changed, so typing a name is never overridden', () => {
    const before = scn('Roman Empire (117) vs Spain (2026)', ['Roman Empire', ['rome-117']], ['Spain', ['spain-2026']]);
    const typed = scn('Roman Empire (117) vs Spain (2026)', ['Rom', ['rome-117']], ['Spain', ['spain-2026']]);
    expect(followNames(before, typed, d)).toBe(typed);
  });
});
