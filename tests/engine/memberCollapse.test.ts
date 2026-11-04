import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/engine/sim';
import { victoryPhase } from '../../src/engine/victory';
import { NR } from '../../src/engine/roles';
import type { EngineData } from '../../src/engine/protocol';
import { NATIONS, fixtureScenario, makeSnapshot, type NationSpec } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

// Germany 1944 against Spain and Switzerland ended when the Swiss (82% of the side) collapsed,
// although Spain still stood at full strength: the side's pooled personnel decided for both.
// MEMBER_COLLAPSE judges each member that carries a real share against what it fielded.

const ally = (forces: number): NationSpec => ({
  id: `ally-${forces}-1900`, name: 'Southland', year: 1900, tech: 6, capital: { lat: 5, lon: 11 }, rect: [10, 0, 12, 10],
  forces: { infantry_line: forces },
});
const rect = ([w, s, e, n]: [number, number, number, number]): number[][][][] => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];

function coalition(spec: NationSpec): Sim {
  const d = data();
  const withAlly: EngineData = { ...d, snapshots: [...d.snapshots, makeSnapshot(spec)], borders: { ...d.borders, [spec.id]: rect(spec.rect) } };
  const sc = fixtureScenario(NATIONS.westland, NATIONS.eastland, [0, 0, 12, 10]);
  sc.sides[1].members.push(spec.id);
  const sim = createSim(withAlly, sc);
  sim.step(1);
  return sim;
}

/** Wipe one member's army: every formation and its depot personnel. */
function wipe(sim: Sim, name: string): void {
  const { S, st } = sim.ctx;
  const mi = S.members.findIndex((m) => m.name === name);
  const F = st.F;
  for (let f = 0; f < F.n; f++) if (F.member[f] === mi) F.personnel[f] = 0;
  for (let r = 0; r < NR; r++) st.members[mi].depot[r] = 0;
}

/** Set the morale of every formation of one member. */
function demoralize(sim: Sim, name: string, morale = 0): void {
  const { S, st } = sim.ctx;
  const mi = S.members.findIndex((m) => m.name === name);
  const F = st.F;
  for (let f = 0; f < F.n; f++) if (F.member[f] === mi) F.morale[f] = morale;
}

/** Take one member's formations off the map, still to arrive (a main army sailing in). */
function offMap(sim: Sim, name: string, arriveDay: number): void {
  const { S, st } = sim.ctx;
  const mi = S.members.findIndex((m) => m.name === name);
  const F = st.F;
  for (let f = 0; f < F.n; f++) if (F.member[f] === mi) { F.onMap[f] = 0; F.arriveDay[f] = arriveDay; }
}

describe('morale collapse per coalition member (MEMBER_MORALE_COLLAPSE)', () => {
  it('does not let a vanguard member end the war before the main member arrives', () => {
    // NATO 1989: East Germany alone on the map broke the Warsaw Pact while 750k Soviets were en route
    const sim = coalition(ally(15000));
    offMap(sim, 'Southland', 40);
    demoralize(sim, 'Eastland');
    victoryPhase(sim.ctx);
    expect(sim.ended()).toBe(false);
  });

  it('keeps the side in while one member on the map holds its morale', () => {
    // 8,000 of about 68,000: counted, but too small to hold the pooled morale above the line
    const sim = coalition(ally(8000));
    demoralize(sim, 'Eastland');
    victoryPhase(sim.ctx);
    expect(sim.ended()).toBe(false);
  });

  it('ends the war once every counted member has fallen', () => {
    const sim = coalition(ally(15000));
    demoralize(sim, 'Eastland');
    demoralize(sim, 'Southland');
    victoryPhase(sim.ctx);
    const r = sim.result()!;
    expect(r.winner).toBe(0);
    expect(r.endReason).toContain('morale collapsed');
  });
});

describe('army collapse per coalition member', () => {
  it('keeps the side in the war while a member with a real share still stands', () => {
    const sim = coalition(ally(15000));
    wipe(sim, 'Eastland');
    victoryPhase(sim.ctx);
    expect(sim.ended()).toBe(false);
    expect(sim.ctx.st.events.some((e) => e.kind === 'rout' && e.text.startsWith("Eastland's army collapsed"))).toBe(true);
    wipe(sim, 'Southland');
    victoryPhase(sim.ctx);
    const r = sim.result()!;
    expect(r.winner).toBe(0);
    expect(r.endReason).toContain('every member');
  });

  it('does not let a token contingent hold a broken coalition open', () => {
    // 2,000 of about 62,000 fielded: under MEMBER_COLLAPSE_MIN_SHARE
    const sim = coalition(ally(2000));
    wipe(sim, 'Eastland');
    victoryPhase(sim.ctx);
    expect(sim.result()?.winner).toBe(0);
  });
});
