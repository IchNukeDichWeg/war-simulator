import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, type Timers } from '../src/engine/controller';
import type { FromWorker, ToWorker } from '../src/engine/protocol';
import { createSim } from '../src/engine/sim';
import type { Snapshot } from '../src/types/schema';
import type { AppData } from '../src/ui/data';
import { basicScenario } from './fixtures/snapshots.fixture';
import { data } from './engine/helpers';

// The UI's worker client (src/ui/engine.ts) against a fake Worker that runs the real Controller
// in-process. Messages queue in both directions until the test delivers them, so a test can
// hold messages "in flight" the way a busy real worker does.

/** Timers that never fire: the tests drive the run with step and seek only. */
const idleTimers: Timers = { setTimeout: () => 0, clearTimeout: () => {}, now: () => 0 };

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  sent: ToWorker[] = [];
  toWorker: ToWorker[] = [];
  toUi: FromWorker[] = [];
  terminated = false;
  ctl = new Controller((m) => this.toUi.push(m), idleTimers);
  constructor() { FakeWorker.all.push(this); }
  postMessage(m: ToWorker) { if (this.terminated) return; this.sent.push(m); this.toWorker.push(m); }
  terminate() { this.terminated = true; }
  /** Let the worker handle everything posted to it; its replies stay queued. */
  work() { while (!this.terminated && this.toWorker.length) this.ctl.handle(this.toWorker.shift()!); }
  /** Hand the queued replies to the UI. */
  deliver() { while (!this.terminated && this.toUi.length) this.onmessage?.({ data: this.toUi.shift()! }); }
  /** Both directions until quiet. */
  pump() { while (!this.terminated && (this.toWorker.length || this.toUi.length)) { this.work(); this.deliver(); } }
}

function appData(extra: Snapshot[] = []): AppData {
  const d = data();
  const snapshots = [...d.snapshots, ...extra];
  return {
    snapshots, phase3: [], phase3ById: new Map(), phase3Loaded: [], nations: [], doctrines: d.doctrines,
    mechanics: d.mechanics, coalitions: [], presets: [], borders: d.borders, terrain: d.terrain, climate: null,
    assetsLoaded: true, missing: [], fixtures: false, snapById: new Map(snapshots.map((s) => [s.id, s])), nationById: new Map(),
  };
}

const live = () => FakeWorker.all.filter((w) => !w.terminated).at(-1)!;

async function load() {
  vi.resetModules();
  const st = await import('../src/ui/store');
  const eng = await import('../src/ui/engine');
  const sc = basicScenario(11);
  st.store.set({ data: appData(), scenario: sc });
  return { ...st, ...eng, eng, sc };   // eng: live bindings such as runScenario
}

describe('run client (src/ui/engine.ts)', () => {
  beforeEach(() => { FakeWorker.all = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => { vi.unstubAllGlobals(); });

  // Review finding: seeking forward lost the events of the skipped days; seeking back and
  // forward again must not list any event twice either.
  it('the event log after seeks matches an uninterrupted run, without doubles', async () => {
    const e = await load();
    e.startRun(e.sc, 0);
    live().pump();
    e.stepDays(30); live().pump();
    e.seek(100); live().pump();
    e.seek(47); live().pump();
    e.seek(100); live().pump();
    const ref = createSim(data(), e.sc);
    ref.step(100);
    expect(e.eventLog).toEqual(ref.frame(true).events);
    expect(e.history.day).toEqual([0, 30, 47, 100]);
  });

  // Review finding: frames and the end of the old run, still in flight when a new run started,
  // were applied to the new run (its result shown, its maxDay kept, the Result tab forced).
  it('drops messages the previous run had in flight', async () => {
    const e = await load();
    const short = { ...e.sc, victory: { ...e.sc.victory, timeLimitDays: 20 } };
    e.startRun(short, 0);
    live().pump();
    e.stepDays(40);
    live().work();                       // the old run's frame and end are now in flight
    expect(live().toUi.some((m) => m.type === 'end')).toBe(true);
    e.startRun(e.sc, 0);
    live().deliver();                    // they arrive after the new start was sent
    live().pump();
    const run = e.store.get().run;
    expect(run.status).toBe('running');
    expect(run.result).toBeNull();
    expect(e.store.get().rightTab).toBe('live');
    expect(e.history.day).toEqual([0]);
    await new Promise((r) => setTimeout(r, 150));   // the run panel flush is throttled
    expect(e.store.get().run.day).toBe(0);
    expect(e.store.get().run.maxDay).toBe(0);
  });

  // Review finding: the throttled run-panel flush (pendingRun and its timer) outlived startRun
  // and stopRun, so the old run's day and maxDay landed on the new or stopped run.
  it('a pending run-panel flush does not outlive the run', async () => {
    const wait = () => new Promise((r) => setTimeout(r, 150));
    const e = await load();
    e.startRun(e.sc, 0);
    live().pump();
    e.stepDays(50); live().pump();       // within the throttle: day 50 waits in the flush
    e.startRun(e.sc, 0);
    live().pump();
    await wait();
    expect(e.store.get().run.day).toBe(0);
    expect(e.store.get().run.maxDay).toBe(0);
    e.stepDays(50); live().pump();
    e.stopRun();
    await wait();
    expect(e.store.get().run.status).toBe('idle');
    expect(e.store.get().run.day).toBe(0);
    expect(e.store.get().run.maxDay).toBe(0);
  });

  // Review finding: the live worker got its data once; snapshots merged into the store later
  // (Phase 3 era files) were unknown to it and silently skipped.
  it('a run after new snapshots were merged in sees them', async () => {
    const e = await load();
    e.startRun(e.sc, 0);
    live().pump();
    const orig = data().snapshots.find((s) => s.id === e.sc.sides[1].members[0])!;
    const late = { ...orig, id: `${orig.id}-late` };
    e.store.set({ data: appData([late]) });
    const sc2 = { ...e.sc, sides: [e.sc.sides[0], { ...e.sc.sides[1], members: [late.id] }] as typeof e.sc.sides };
    e.startRun(sc2, 0);
    live().pump();
    const run = e.store.get().run;
    expect(run.engineError).toBeNull();
    expect(run.status).toBe('running');
    expect(run.warnings.filter((w) => /Unknown snapshot/.test(w))).toEqual([]);
  });

  // Review finding: seeking back from an ended run kept status 'ended' (pill "Ended", Space and
  // '.' dead), and finishing again forced the Result tab a second time.
  it('seeking back before the end reopens the run; ending again leaves the tab alone', async () => {
    const e = await load();
    e.startRun({ ...e.sc, victory: { ...e.sc.victory, timeLimitDays: 20 } }, 0);
    live().pump();
    e.stepDays(40); live().pump();
    expect(e.store.get().run.status).toBe('ended');
    expect(e.store.get().rightTab).toBe('result');
    e.store.set({ rightTab: 'live' });
    e.seek(10); live().pump();
    expect(e.store.get().run.status).toBe('running');
    expect(e.store.get().run.speed).toBe(0);
    e.stepDays(40); live().pump();
    expect(e.store.get().run.status).toBe('ended');
    expect(e.store.get().rightTab).toBe('live');
  });

  // Review finding: "Run it again for N years" read the Setup scenario's limit and reran the
  // Setup scenario, even after the user had edited it since the run.
  it('running a war again for longer uses the war that ran', async () => {
    const e = await load();
    const ran = { ...e.sc, victory: { ...e.sc.victory, timeLimitDays: 20 } };
    e.store.set({ scenario: ran });
    e.startRun(ran, 0);
    live().pump();
    e.stepDays(40); live().pump();
    const starts = () => live().sent.filter((m) => m.type === 'start').map((m) => (m as { scenario: typeof ran }).scenario);
    // Setup still holds that war: it takes the longer limit
    e.rerunLonger(40, 0);
    expect(starts().at(-1)).toMatchObject({ seed: 11, victory: { timeLimitDays: 40 } });
    expect(e.store.get().scenario.victory.timeLimitDays).toBe(40);
    live().pump();
    e.stepDays(50); live().pump();
    // Setup edited since the run: the war that ran goes again, the edits stay in Setup
    const edited = { ...e.store.get().scenario, seed: 99, victory: { ...ran.victory, timeLimitDays: 100 } };
    e.store.set({ scenario: edited });
    expect(e.eng.runScenario?.victory.timeLimitDays).toBe(40);
    e.rerunLonger(80, 0);
    expect(starts().at(-1)).toMatchObject({ seed: 11, victory: { timeLimitDays: 80 } });
    expect(e.store.get().scenario).toBe(edited);
  });

  // Review finding: an ended run stayed on the map (units and box of the old war, recoloured)
  // after the user loaded another matchup.
  it('loading another matchup clears an ended run; edits to the same war keep it', async () => {
    const e = await load();
    const ran = { ...e.sc, victory: { ...e.sc.victory, timeLimitDays: 20 } };
    e.store.set({ scenario: ran });
    e.startRun(ran, 0);
    live().pump();
    e.stepDays(40); live().pump();
    expect(e.store.get().run.status).toBe('ended');
    e.store.set({ scenario: { ...ran, seed: 5, victory: { ...ran.victory, timeLimitDays: 400 } } });
    expect(e.store.get().run.status).toBe('ended');
    const other = data().snapshots.find((s) => !ran.sides.some((d) => d.members.includes(s.id)))!;
    e.store.set({ scenario: { ...ran, sides: [ran.sides[0], { ...ran.sides[1], members: [other.id] }] } });
    expect(e.store.get().run.status).toBe('idle');
    expect(e.store.get().run.theater).toBeNull();
    expect(e.history.day).toEqual([]);
  });

  // Review finding: the Odds tab labelled a batch with the live run's side names, which may
  // belong to a different war.
  it('a Monte Carlo batch keeps its own side names', async () => {
    const e = await load();
    e.runMonteCarlo(e.sc, 2);
    const renamed = { ...e.sc, sides: [{ ...e.sc.sides[0], name: 'Other A' }, { ...e.sc.sides[1], name: 'Other B' }] as typeof e.sc.sides };
    e.store.set({ scenario: renamed });
    e.startRun(renamed, 0);
    FakeWorker.all.at(-1)!.pump();
    expect(e.store.get().run.sideNames).toEqual(['Other A', 'Other B']);
    expect(e.mcSideNames()).toEqual([e.sc.sides[0].name, e.sc.sides[1].name]);
  });
});
