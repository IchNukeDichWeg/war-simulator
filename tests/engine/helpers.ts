// Shared helpers for the engine tests (fixture data only, see tests/fixtures).
import { fixtureData } from '../fixtures/snapshots.fixture';
import type { EngineData } from '../../src/engine/protocol';
import type { Sim } from '../../src/engine/sim';
import { depotPersonnel } from '../../src/engine/production';

let cached: EngineData | null = null;
/** Fixture data is immutable in the engine, so one copy serves every test. */
export function data(): EngineData {
  return (cached ??= fixtureData());
}

/** Personnel currently held by a side: formations (on and off the map) plus depots. */
export function personnelNow(sim: Sim, side: 0 | 1): number {
  const F = sim.ctx.st.F;
  let p = 0;
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.side[f] === side) p += F.personnel[f];
  return p + depotPersonnel(sim.ctx, side);
}

export function totalLosses(sim: Sim, side: 0 | 1): number {
  return Array.from(sim.ctx.st.losses[side]).reduce((a, b) => a + b, 0);
}
