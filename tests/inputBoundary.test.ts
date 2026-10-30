// Untrusted scenario input: share links, loaded files and Editor values (red team
// report C1, C2, C3, C5, W1). Each block pins one boundary check.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FORMATIONS_PER_MEMBER } from '../src/engine/constants';
import { Controller } from '../src/engine/controller';
import type { FromWorker } from '../src/engine/protocol';
import { NR } from '../src/engine/roles';
import { createSim } from '../src/engine/sim';
import { fieldBound, MAX_RESEARCHED_FORCE_COUNT, overrideMax, overridePathProblem, overrideValueProblem } from '../src/engine/overridePath';
import { collectFields } from '../src/ui/panels/Editor';
import type { Snapshot } from '../src/types/schema';
import { normalizeScenario } from '../src/ui/scenarioDefaults';
import { decodeScenario, encodeScenario } from '../src/ui/scenarioIO';
import type { Scenario } from '../src/types/scenario';
import { absurdScenario, basicScenario, fixtureData, perfScenario } from './fixtures/snapshots.fixture';
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

  it('the bound covers every researched field in public/data (fails if the data outgrows it)', () => {
    const dir = 'public/data';
    let n = 0;
    for (const f of readdirSync(dir).filter((x) => /^snapshots.*\.json$/.test(x) && !x.includes('index'))) {
      const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
      const snaps: Snapshot[] = Array.isArray(j) ? j : j.snapshots ?? [];
      for (const s of snaps) {
        // every field the Editor offers, so a new field without a bound fails here too
        for (const { path, est } of collectFields(s)) {
          const b = fieldBound(path);
          expect(b, `${s.id} ${path} has no bound`).toBeDefined();
          const top = 'researched' in b! ? b.researched : b!.scaleTop;
          expect(Math.max(est.low, est.mid, est.high), `${s.id} ${path}`).toBeLessThanOrEqual(top);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(50_000);
  });
});

describe('N1: every personnel, stock, rating and tech field is bounded', () => {
  it.each([
    ['military.trainedReserves.mid', 1e15],
    ['military.mobilizable.mid', 1e15],
    ['military.activePersonnel.mid', 1e15],
    ['demography.population.mid', 1e15],
    ['economy.annualCohort.mid', 1e15],
    ['economy.production.armor.mid', 1e12],
    ['logistics.supplyRangeKm.mid', 1e15],
    ['strategic.nuclearWarheads.mid', 1e12],
    ['geography.homeDefense.mid', 1e300],
    ['tech.weapons.mid', 10.5],
    ['tech.weapons.mid', 1e300],
    ['military.morale.mid', 1.01],
    ['military.forces.infantry_line.quality.mid', 1e300],
  ])('refuses %s = %s', (path, v) => {
    expect(overridePathProblem(path)).toBeNull();
    expect(overrideValueProblem(path, v)).not.toBeNull();
  });

  it('a stock field takes 10x its researched maximum and no more', () => {
    const p = 'military.trainedReserves.mid';
    expect(overrideMax(p)).toBe(100_000_000);   // 10x china-1979
    expect(overrideValueProblem(p, 100_000_000)).toBeNull();
    expect(overrideValueProblem(p, 100_000_001)).toMatch(/at most 100,000,000/);
  });

  it('ratings and tech take the top of their scale', () => {
    expect(overrideValueProblem('tech.cyber.mid', 10)).toBeNull();
    expect(overrideValueProblem('military.cohesion.mid', 1)).toBeNull();
    expect(overrideValueProblem('military.forces.armor.training.mid', 1)).toBeNull();
  });

  it.each(['tech.newcategory.mid', 'military.foo.mid', 'economy.production.infantry_line.mid', 'military.forces.armor.speed.mid'])('refuses the field-less path %s', (p) => {
    expect(overridePathProblem(p)).not.toBeNull();
  });

  it('a loaded scenario with 1e15 trained reserves is refused, naming the field', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: 'military.trainedReserves.mid', value: 1e15 }] };
    expect(() => normalizeScenario(JSON.parse(JSON.stringify(sc)))).toThrow(/overrides\[0\]\.value: military\.trainedReserves\.mid must be at most/);
  });

  it('the engine ignores 1e15 trained reserves instead of fielding them', () => {
    const sc = { ...basicScenario(), overrides: [{ snapshotId: 'westland-1900', path: 'military.trainedReserves.mid', value: 1e15 }] };
    const sim = createSim(data(), sc);
    expect(sim.setup.warnings.some((w) => w.includes('ignored') && w.includes('trainedReserves'))).toBe(true);
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

describe('C5: share links unpack to a bounded size', () => {
  const presets = JSON.parse(readFileSync('public/data/presets.json', 'utf8')) as Scenario[];

  it('every preset round-trips through a share link', async () => {
    for (const p of presets) expect(await decodeScenario(await encodeScenario(p))).toEqual(normalizeScenario(structuredClone(p)));
  });

  it('a deflate bomb is refused with a clear message', async () => {
    const bomb = { ...presets[0], sides: [{ ...presets[0].sides[0], name: 'A'.repeat(8 << 20) }, presets[0].sides[1]] };
    const code = await encodeScenario(bomb as Scenario);
    expect(code.length).toBeLessThan(12_000);   // an 8 MB scenario in a short link
    await expect(decodeScenario(code)).rejects.toThrow(/larger than 16 KB once unpacked/);
  });

  it('a garbage code gives a message, not an empty error', async () => {
    await expect(decodeScenario('AAAA')).rejects.toThrow(/damaged/);
  });

  it.each([
    ['name', (s: any) => { s.name = 'x'.repeat(201); }],
    ['description', (s: any) => { s.description = 'x'.repeat(2001); }],
    ['sides[1].name', (s: any) => { s.sides[1].name = 'x'.repeat(101); }],
    ['sides[0].members[0]', (s: any) => { s.sides[0].members[0] = 'x'.repeat(101); }],
  ])('an over-long %s is refused, naming the field', (field, mut) => {
    const s = structuredClone(presets[0]);
    mut(s);
    expect(() => normalizeScenario(s)).toThrow(new RegExp(field.replace(/[[\]]/g, '\\$&')));
  });
});

describe('W1: loaded scenarios are type-checked', () => {
  const presets = JSON.parse(readFileSync('public/data/presets.json', 'utf8')) as Scenario[];
  const base = () => structuredClone(presets[6]) as any;   // germany-vs-france-1940

  it.each([
    ['rules.nuclear', (s: any) => { s.rules.nuclear = 'false'; }],
    ['victory.capitalCaptured', (s: any) => { s.victory.capitalCaptured = 'no'; }],
    ['victory.timeLimitDays', (s: any) => { s.victory.timeLimitDays = 'abc'; }],
    ['techMode', (s: any) => { s.techMode = 'bogus'; }],
    ['equalizedTech', (s: any) => { s.techMode = 'equalized'; s.equalizedTech = 'abc'; }],
    ['sides[0].commitment.germany-1939', (s: any) => { s.sides[0].commitment = { 'germany-1939': 'lots' }; }],
    ['sides[0].startPositions', (s: any) => { s.sides[0].startPositions = 'x'; }],
    ['excluded[0]', (s: any) => { s.excluded = [{}, 5, null]; }],
    ['startMonth', (s: any) => { s.startMonth = 'abc'; }],
    ['seed', (s: any) => { s.seed = 'x'; }],
    ['theater.bbox', (s: any) => { s.theater.bbox = [1, 2, 3]; }],
    ['rules', (s: any) => { s.rules = 5; }],
    ['sides[1].members[0]', (s: any) => { s.sides[1].members = [7]; }],
    ['overrides[0].snapshotId', (s: any) => { s.overrides = [{ path: 'tech.weapons.mid', value: 1 }]; }],
  ])('a wrong type at %s is refused, naming the field', (field, mut) => {
    const s = base();
    mut(s);
    expect(() => normalizeScenario(s)).toThrow(new RegExp('^' + field.replace(/[[\].]/g, '\\$&') + ' '));
  });

  it('commitment, startMonth and the time limit are clamped to their ranges', () => {
    const s = base();
    s.sides[0].commitment = { 'germany-1939': 5 };
    s.sides[1].commitment = { 'france-1939': -1 };
    s.startMonth = 13;
    s.victory.timeLimitDays = 1e9;
    s.equalizedTech = 12;
    let n = normalizeScenario(s);
    expect(n.sides[0].commitment).toEqual({ 'germany-1939': 1 });
    expect(n.sides[1].commitment).toEqual({ 'france-1939': 0 });
    expect(n.startMonth).toBe(12);
    expect(n.victory.timeLimitDays).toBe(36500);
    expect(n.equalizedTech).toBe(10);
    s.startMonth = -4; s.victory.timeLimitDays = -1;
    n = normalizeScenario(s);
    expect([n.startMonth, n.victory.timeLimitDays]).toEqual([1, 1]);
    s.startMonth = 2.5;
    expect(normalizeScenario(s).startMonth).toBe(3);
  });

  it('only known fields are copied', () => {
    const s = JSON.parse('{"__proto__":{"polluted":1},"extra":1,' + JSON.stringify(base()).slice(1));
    const n = normalizeScenario(s) as any;
    expect(Object.prototype.hasOwnProperty.call(n, '__proto__')).toBe(false);
    expect(n.extra).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });

  it('every preset, the dev fixture preset and the test fixtures load unchanged', async () => {
    const { devFixtures } = await import('../src/ui/devFixtures/fixtures');
    const all = [...presets, ...JSON.parse(readFileSync('data/presets.json', 'utf8')), ...devFixtures().presets, basicScenario(), absurdScenario(), perfScenario()];
    for (const p of all) {
      const n = normalizeScenario(structuredClone(p));
      expect(n, p.id).toMatchObject(JSON.parse(JSON.stringify(p)));
      // a file saved from the loaded scenario loads back to the same scenario
      expect(normalizeScenario(JSON.parse(JSON.stringify(n, null, 2)))).toEqual(n);
    }
  });
});
