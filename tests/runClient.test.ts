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
  return { ...st, ...eng, sc };
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
});
