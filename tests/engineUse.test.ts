import { describe, expect, it } from 'vitest';
import { overrideMax } from '../src/engine/overridePath';
import { createSim } from '../src/engine/sim';
import { ENGINE_USE } from '../src/ui/engineUse';
import { collectFields } from '../src/ui/panels/Editor';
import { basicScenario } from './fixtures/snapshots.fixture';
import { data } from './engine/helpers';

// Red team W3: the Editor offered every Est as an input to the run, but some are never read.
// The Editor now tags them; this checks the tags against the engine itself.
const state = (overrides: { snapshotId: string; path: string; value: number }[]) => {
  const sim = createSim(data(), { ...basicScenario(1), overrides });
  sim.step(60);
  const st = sim.ctx.st;
  return JSON.stringify([st.day, st.winner, Array.from(st.control), Array.from(st.F.personnel.subarray(0, st.F.n)), Array.from(st.losses[0]), Array.from(st.losses[1])]);
};

describe('Editor fields the engine does not read', () => {
  const sc = basicScenario(1);
  const ids = sc.sides.flatMap((s) => s.members);
  const base = state([]);
  const unused = Object.entries(ENGINE_USE).filter(([, u]) => u.used === false).map(([p]) => p);

  it('name real editable fields', () => {
    const snap = data().snapshots.find((s) => s.id === ids[0])!;
    const paths = new Set(collectFields(snap).map((f) => f.path));
    for (const p of Object.keys(ENGINE_USE)) expect(paths.has(p), p).toBe(true);
  });

  // the largest value an override may hold: 1e12 is above most bounds now (red team N1), and
  // an override the engine refuses would leave the run unchanged whether or not it reads the field
  it.each(unused)('%s at 0 or its override bound leaves the run unchanged', (p) => {
    for (const value of [0, overrideMax(`${p}.mid`)!]) expect(state(ids.map((snapshotId) => ({ snapshotId, path: `${p}.mid`, value })))).toBe(base);
  });

  it('home defense is read (the red team saw no effect only because the attacker never defended at home)', () => {
    expect(ENGINE_USE['geography.homeDefense']).toBeUndefined();
    expect(state(ids.map((snapshotId) => ({ snapshotId, path: 'geography.homeDefense.mid', value: 3 })))).not.toBe(base);
  });
});
