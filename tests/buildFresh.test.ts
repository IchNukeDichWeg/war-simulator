// Stale-build guard: public/data/battles.json and mechanics.json must equal a fresh build of data/.
// A data/ edit without `npx tsx data-pipeline/build.ts` silently changed the backtest (QA round 2,
// and 39490b0 changed modelRules.json while the engine kept reading the old public copy).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBattles, buildMechanics, invalidFiles } from '../data-pipeline/build';
import { ROOT } from '../data-pipeline/lib/util';

const pub = (name: string) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', name), 'utf8'));

describe('public/data is built from the current data/', () => {
  const bad = invalidFiles();
  it('battles.json is not stale (run: npx tsx data-pipeline/build.ts)', () => {
    expect(pub('battles.json')).toEqual(buildBattles(bad));
  });
  it('mechanics.json is not stale (run: npx tsx data-pipeline/build.ts)', () => {
    const { version: _a, ...built } = buildMechanics(bad);
    const { version: _b, ...shipped } = pub('mechanics.json');
    void _a; void _b;
    expect(shipped).toEqual(built);
  });
});
