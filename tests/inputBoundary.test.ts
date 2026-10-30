// Untrusted scenario input: share links, loaded files and Editor values (red team
// report C1, C2, C3, C5, W1). Each block pins one boundary check.
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../src/engine/controller';
import type { FromWorker } from '../src/engine/protocol';
import { createSim } from '../src/engine/sim';
import { overridePathProblem } from '../src/engine/overridePath';
import { normalizeScenario } from '../src/ui/scenarioDefaults';
import { basicScenario } from './fixtures/snapshots.fixture';
import { data } from './engine/helpers';

const PROTO_KEYS = ['voronoiControl', 'terrainOverride', 'noProduction', 'polluted'];
const protoClean = () => PROTO_KEYS.every((k) => !Object.prototype.hasOwnProperty.call(Object.prototype, k));

describe('C1: override paths cannot reach a prototype', () => {
  // a failing run would leave Object.prototype polluted for every later test in the file
  afterEach(() => { for (const k of PROTO_KEYS) delete (Object.prototype as any)[k]; });

  const hostile = ['__proto__.voronoiControl', '__proto__.terrainOverride', 'constructor.prototype.polluted',
    'military.__proto__.polluted', 'tech.constructor.polluted', 'military', 'capital.lat', 'tech.weapons', 'military.forces.infantry_line.count.low'];

  it.each(hostile)('rejects %s', (path) => {
    expect(overridePathProblem(path)).not.toBeNull();
  });

  it('accepts the paths the Editor writes', () => {
    for (const p of ['military.forces.infantry_line.count.mid', 'economy.production.armor.mid', 'tech.weapons.mid', 'demography.population.mid']) {
      expect(overridePathProblem(p)).toBeNull();
    }
  });

  it('a loaded scenario with a __proto__ override path is refused, naming the field', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: '__proto__.voronoiControl', value: 1 }] };
    expect(() => normalizeScenario(JSON.parse(JSON.stringify(sc)))).toThrow(/overrides\[0\]\.path/);
  });

  it('the engine ignores a __proto__ override and leaves Object.prototype clean', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: '__proto__.voronoiControl', value: 1 }] };
    const sim = createSim(data(), sc);
    expect(protoClean()).toBe(true);
    expect(sim.setup.warnings.some((w) => w.includes('__proto__.voronoiControl'))).toBe(true);
  });

  it('a polluting start in the worker does not corrupt the next run', () => {
    const msgs: FromWorker[] = [];
    const ctl = new Controller((m) => msgs.push(m));
    ctl.handle({ type: 'init', data: data() });
    const clean = () => { ctl.handle({ type: 'start', scenario: basicScenario(3) }); ctl.handle({ type: 'step', days: 40 }); return msgs.filter((m) => m.type === 'frame').at(-1); };
    const before = JSON.stringify(clean());
    for (const path of ['__proto__.voronoiControl', '__proto__.terrainOverride', '__proto__.noProduction']) {
      ctl.handle({ type: 'start', scenario: { ...basicScenario(3), overrides: [{ snapshotId: 'westland-1900', path, value: path.endsWith('Override') ? 0 : 1 }] } });
    }
    expect(protoClean()).toBe(true);
    expect(JSON.stringify(clean())).toBe(before);
    expect(msgs.some((m) => m.type === 'error')).toBe(false);
  });
});
