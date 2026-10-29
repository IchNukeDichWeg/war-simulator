import { describe, expect, it } from 'vitest';
import { createSim, runToEnd } from '../../src/engine/sim';
import { basicScenario } from '../fixtures/snapshots.fixture';
import { data } from './helpers';

describe('determinism', () => {
  it('same seed gives an identical run and final state', () => {
    const a = createSim(data(), basicScenario(7));
    const b = createSim(data(), basicScenario(7));
    const ra = runToEnd(a), rb = runToEnd(b);
    expect(ra).toEqual(rb);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(ra.endDay).toBeGreaterThan(0);
  });

  it('a different seed changes the run', () => {
    const a = createSim(data(), basicScenario(1));
    const b = createSim(data(), basicScenario(2));
    a.step(60); b.step(60);
    expect(a.snapshot().F.personnel).not.toEqual(b.snapshot().F.personnel);
  });
});
