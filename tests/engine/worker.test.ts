import { describe, expect, it } from 'vitest';
import { Controller, type Timers } from '../../src/engine/controller';
import type { Frame, FromWorker } from '../../src/engine/protocol';
import { createSim } from '../../src/engine/sim';
import { basicScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

/** Manual clock: timers fire only when the test advances time. */
class FakeTimers implements Timers {
  t = 0;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  setTimeout(fn: () => void, ms: number) { const id = ++this.id; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  now() { return this.t; }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

function harness() {
  const msgs: FromWorker[] = [];
  const timers = new FakeTimers();
  const ctl = new Controller((m) => msgs.push(m), timers);
  const frames = () => msgs.filter((m): m is { type: 'frame'; frame: Frame } => m.type === 'frame').map((m) => m.frame);
  return { msgs, timers, ctl, frames };
}

describe('worker protocol (Controller)', () => {
  it('answers init with ready and start with started + a frame with control', () => {
    const h = harness();
    h.ctl.handle({ type: 'init', data: data() });
    expect(h.msgs[0]).toEqual({ type: 'ready' });
    h.ctl.handle({ type: 'start', scenario: basicScenario(5) });
    expect(h.msgs[1].type).toBe('started');
    const f = h.frames()[0];
    expect(f.day).toBe(0);
    expect(f.control).toBeInstanceOf(Uint8Array);
    expect(f.units.length % 12).toBe(0);
  });

  it('errors on start before init', () => {
    const h = harness();
    h.ctl.handle({ type: 'start', scenario: basicScenario(5) });
    expect(h.msgs[0].type).toBe('error');
  });

  it('seek replays to exactly the state of an uninterrupted run', () => {
    const h = harness();
    h.ctl.handle({ type: 'init', data: data() });
    h.ctl.handle({ type: 'start', scenario: basicScenario(11) });
    h.ctl.handle({ type: 'step', days: 100 });
    const at100 = h.frames().at(-1)!;
    // back to a day between keyframes, then forward again past the last one
    h.ctl.handle({ type: 'seek', day: 47 });
    const at47 = h.frames().at(-1)!;
    expect(at47.day).toBe(47);
    const ref = createSim(data(), basicScenario(11));
    ref.step(47);
    const sim = (h.ctl as unknown as { sim: typeof ref }).sim;
    expect(sim.snapshot()).toEqual(ref.snapshot());
    expect(Array.from(at47.units)).toEqual(Array.from(ref.frame(true).units));
    h.ctl.handle({ type: 'seek', day: 100 });
    const again = h.frames().at(-1)!;
    expect(again.day).toBe(100);
    expect(Array.from(again.units)).toEqual(Array.from(at100.units));
    expect(again.stats).toEqual(at100.stats);
  });

  it('real-time speed paces by the clock with fractional accumulation and at most 30 frames/s', () => {
    const h = harness();
    h.ctl.handle({ type: 'init', data: data() });
    h.ctl.handle({ type: 'start', scenario: basicScenario(5) });
    const before = h.frames().length;
    h.ctl.handle({ type: 'speed', daysPerSecond: 2.5 });
    h.timers.advance(2010);                      // 2 s plus slack for float tick times
    const fs = h.frames().slice(before);
    expect(fs.at(-1)!.day).toBe(5);              // 2.5 days/s x 2 s, fractions carried over
    expect(fs.length).toBeLessThanOrEqual(60);   // 30 frames/s cap
    h.ctl.handle({ type: 'speed', daysPerSecond: 0 });
    h.timers.advance(2000);
    expect(h.frames().at(-1)!.day).toBe(5);      // paused
  });

  it('montecarlo reports progress and a summary without frames', () => {
    const h = harness();
    h.ctl.handle({ type: 'init', data: data() });
    const sc = { ...basicScenario(1), victory: { ...basicScenario(1).victory, timeLimitDays: 60 } };
    h.ctl.handle({ type: 'montecarlo', scenario: sc, runs: 4 });
    h.timers.advance(10);
    const res = h.msgs.find((m) => m.type === 'mcResult');
    expect(res && res.type === 'mcResult' && res.result.runs).toBe(4);
    expect(h.msgs.some((m) => m.type === 'mcProgress')).toBe(true);
    expect(h.frames().length).toBe(0);
    if (res?.type === 'mcResult') expect(res.result.winProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});
