// Worker-side controller: implements the ToWorker/FromWorker protocol on top of
// the sim. Kept free of worker globals so tests and node can drive it with a
// fake post function and timers.
import type { EngineData, FromWorker, RunResult, ToWorker } from './protocol';
import type { Scenario } from '../types/scenario';
import { buildSetup, type Setup } from './setup';
import { simFromSetup, runToEnd, type Sim } from './sim';
import type { SimState } from './state';
import { summarize } from './montecarlo';
import { KEYFRAME_DAYS, MAX_FRAMES_PER_SECOND } from './constants';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

/** Max wall time spent stepping per tick, so messages (pause, seek) stay responsive. */
const TICK_BUDGET_MS = 40;

export class Controller {
  private data: EngineData | null = null;
  private sim: Sim | null = null;
  private keyframes = new Map<number, SimState>();
  private maxDay = 0;
  private dps = 0;
  private acc = 0;
  private last = 0;
  private timer: unknown = null;
  private endSent = false;
  private mcToken = 0;

  constructor(private post: (msg: FromWorker, transfer?: Transferable[]) => void, private timers: Timers = defaultTimers) {}

  handle(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case 'init':
          this.data = msg.data;
          this.post({ type: 'ready' });
          break;
        case 'start': this.start(msg.scenario); break;
        case 'speed': this.setSpeed(msg.daysPerSecond); break;
        case 'step': this.stepDays(msg.days); break;
        case 'seek': this.seek(msg.day); break;
        case 'montecarlo': this.monteCarlo(msg.scenario, msg.runs); break;
      }
    } catch (e) {
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private requireData(): EngineData {
    if (!this.data) throw new Error('worker not initialised: send {type:"init"} first');
    return this.data;
  }

  private start(scenario: Scenario): void {
    this.stopLoop();
    this.dps = 0;
    const setup = buildSetup(this.requireData(), scenario);
    this.sim = simFromSetup(setup, scenario.seed);
    this.keyframes.clear();
    this.keyframes.set(0, this.sim.snapshot());
    this.maxDay = 0;
    this.endSent = false;
    this.post({ type: 'started', theater: setup.theater, sideNames: setup.sideNames, warnings: setup.warnings });
    this.sendFrame(true);
  }

  private sendFrame(forceControl = false): void {
    if (!this.sim) return;
    const frame = this.sim.frame(forceControl);
    this.post({ type: 'frame', frame }, [frame.units.buffer as ArrayBuffer, ...(frame.control ? [frame.control.buffer as ArrayBuffer] : [])]);
    if (this.sim.ended() && !this.endSent) {
      this.endSent = true;
      this.stopLoop();
      this.post({ type: 'end', result: this.sim.result()! });
    }
  }

  /** Step one day, recording keyframes. */
  private stepOne(): void {
    const sim = this.sim!;
    sim.step(1);
    const d = sim.day();
    if (d > this.maxDay) this.maxDay = d;
    if (d % KEYFRAME_DAYS === 0 && !this.keyframes.has(d)) this.keyframes.set(d, sim.snapshot());
  }

  private stepDays(days: number): void {
    if (!this.sim) throw new Error('no scenario started');
    const n = Math.max(0, Math.floor(days));
    for (let i = 0; i < n && !this.sim.ended(); i++) this.stepOne();
    this.sendFrame();
  }

  private setSpeed(dps: number): void {
    this.dps = Math.max(0, dps || 0);
    if (this.dps > 0 && this.sim && !this.sim.ended()) {
      if (this.timer == null) { this.last = this.timers.now(); this.acc = 0; this.schedule(); }
    } else this.stopLoop();
  }

  private schedule(): void {
    this.timer = this.timers.setTimeout(() => this.tick(), 1000 / MAX_FRAMES_PER_SECOND);
  }

  private stopLoop(): void {
    if (this.timer != null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.timer = null;
    const sim = this.sim;
    if (!sim || this.dps <= 0) return;
    const now = this.timers.now();
    this.acc += (this.dps * (now - this.last)) / 1000;
    this.last = now;
    let n = Math.floor(this.acc + 1e-9);   // epsilon: 60 x (2.5 x 1/30) sums to 4.999...
    this.acc -= n;
    const t0 = this.timers.now();
    let stepped = 0;
    while (n > 0 && !sim.ended()) {
      this.stepOne();
      n--; stepped++;
      if (this.timers.now() - t0 > TICK_BUDGET_MS) { this.acc = 0; break; }   // cannot keep up: drop the backlog
    }
    if (stepped > 0) this.sendFrame();
    if (!sim.ended() && this.dps > 0) this.schedule();
  }

  private seek(day: number): void {
    const sim = this.sim;
    if (!sim) throw new Error('no scenario started');
    const target = Math.max(0, Math.floor(day));
    if (target < sim.day() || target <= this.maxDay) {
      let best = 0;
      for (const k of this.keyframes.keys()) if (k <= target && k > best) best = k;
      sim.restore(this.keyframes.get(best)!);
      this.endSent = false;
    }
    while (sim.day() < target && !sim.ended()) this.stepOne();
    sim.resetCursor(sim.day());
    this.sendFrame(true);
  }

  private monteCarlo(scenario: Scenario, runs: number): void {
    const token = ++this.mcToken;
    const setup: Setup = buildSetup(this.requireData(), scenario);
    const total = Math.max(1, Math.floor(runs));
    const results: RunResult[] = [];
    let lastPost = 0;
    const next = () => {
      if (token !== this.mcToken) return;
      try {
        results.push(runToEnd(simFromSetup(setup, (scenario.seed + results.length) >>> 0)));
      } catch (e) {
        this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      const now = this.timers.now();
      if (results.length === total || now - lastPost > 1000 / MAX_FRAMES_PER_SECOND) {
        lastPost = now;
        this.post({ type: 'mcProgress', done: results.length, total });
      }
      if (results.length < total) this.timers.setTimeout(next, 0);
      else this.post({ type: 'mcResult', result: summarize(results) });
    };
    this.timers.setTimeout(next, 0);
  }
}
