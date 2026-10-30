// Untrusted scenario input: share links, loaded files and Editor values (red team
// report C1, C2, C3, C5, W1). Each block pins one boundary check.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FORMATIONS_PER_MEMBER } from '../src/engine/constants';
import { Controller } from '../src/engine/controller';
import type { FromWorker } from '../src/engine/protocol';
import { NR } from '../src/engine/roles';
import { createSim } from '../src/engine/sim';
import { MAX_RESEARCHED_FORCE_COUNT, overridePathProblem, overrideValueProblem } from '../src/engine/overridePath';
import type { Snapshot, UnitRole } from '../src/types/schema';
import { normalizeScenario } from '../src/ui/scenarioDefaults';
import { basicScenario, fixtureData } from './fixtures/snapshots.fixture';
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

describe('C2/C3: override values are finite, non-negative and bounded', () => {
  const INF = 'military.forces.infantry_line.count.mid';

  it.each([-50000, -1, NaN, Infinity, 1e9, 1e15, '5'])('rejects infantry count %s', (v) => {
    expect(overrideValueProblem(INF, v)).not.toBeNull();
  });

  it('accepts 0 and the bound itself', () => {
    expect(overrideValueProblem(INF, 0)).toBeNull();
    expect(overrideValueProblem(INF, 10 * MAX_RESEARCHED_FORCE_COUNT.infantry_line)).toBeNull();
    expect(overrideValueProblem(INF, 10 * MAX_RESEARCHED_FORCE_COUNT.infantry_line + 1)).not.toBeNull();
  });

  it('a loaded scenario with a negative count is refused, naming the field', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: INF, value: -50000 }] };
    expect(() => normalizeScenario(JSON.parse(JSON.stringify(sc)))).toThrow(/overrides\[0\]\.value/);
  });

  it('the engine ignores a negative count instead of fielding negative formations', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: INF, value: -50000 }] };
    const sim = createSim(data(), sc);
    expect(sim.setup.warnings.some((w) => w.includes('ignored') && w.includes('at least 0'))).toBe(true);
    sim.step(30);
    const F = sim.ctx.st.F;
    for (let i = 0; i < F.n * NR; i++) expect(F.counts[i]).toBeGreaterThanOrEqual(0);
  });

  it('the bound covers every researched count in public/data (fails if the data outgrows it)', () => {
    const dir = 'public/data';
    for (const f of readdirSync(dir).filter((x) => /^snapshots.*\.json$/.test(x) && !x.includes('index'))) {
      const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
      const snaps: Snapshot[] = Array.isArray(j) ? j : j.snapshots ?? [];
      for (const s of snaps) {
        for (const [role, e] of Object.entries(s.military.forces)) {
          const c = e?.count;
          if (c) expect(Math.max(c.low, c.mid, c.high), `${s.id} ${role}`).toBeLessThanOrEqual(MAX_RESEARCHED_FORCE_COUNT[role as UnitRole]);
        }
      }
    }
  });
});

describe('C2: formations per member stay capped after day 0', () => {
  it('a 1e9-strong army does not add formations without bound', () => {
    // set in the data, not as an override, so the override bound does not stop it first
    const d = fixtureData();
    d.snapshots = d.snapshots.map((s) => {
      if (s.id !== 'westland-1900') return s;
      const c = structuredClone(s);
      c.military.forces.infantry_line!.count.mid = 1e9;
      return c;
    });
    const sim = createSim(d, basicScenario(1));
    const seeds = sim.setup.seeds.length;
    for (let day = 0; day < 60 && !sim.ended(); day++) {
      sim.step(1);
      const F = sim.ctx.st.F;
      const alive = new Map<number, number>();
      for (let f = 0; f < F.n; f++) if (F.alive[f]) alive.set(F.member[f], (alive.get(F.member[f]) ?? 0) + 1);
      for (const n of alive.values()) expect(n).toBeLessThanOrEqual(MAX_FORMATIONS_PER_MEMBER);
    }
    // before the cap F.n grew by hundreds a day here
    expect(sim.ctx.st.F.n - seeds).toBeLessThan(200);
  });
});
