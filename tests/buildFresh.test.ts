// Stale-build guard: public/data/battles.json and mechanics.json must equal a fresh build of data/.
// A data/ edit without `npx tsx data-pipeline/build.ts` silently changed the backtest (QA round 2,
// and 39490b0 changed modelRules.json while the engine kept reading the old public copy).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBattles, buildMechanics, invalidFiles } from '../data-pipeline/build';
import { listJson } from '../data-pipeline/validate';
import { ROOT } from '../data-pipeline/lib/util';

const pub = (name: string) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', name), 'utf8'));

describe('public/data is built from the current data/', () => {
  const bad = invalidFiles();
  it('battles.json is not stale (run: npx tsx data-pipeline/build.ts)', () => {
    expect(pub('battles.json')).toEqual(buildBattles(bad));
  });
  it('mechanics.json is not stale (run: npx tsx data-pipeline/build.ts)', () => {
    // the version is a content hash, so it is compared too
    expect(pub('mechanics.json')).toEqual(buildMechanics(bad));
  });
  // copied through by the build: an edit in data/ without a rebuild shipped the old copy
  it.each(['presets.json', 'coalitions.json'])('%s is not stale (run: npx tsx data-pipeline/build.ts)', (name) => {
    expect(pub(name)).toEqual(JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8')));
  });
  it('doctrines.json is not stale (run: npx tsx data-pipeline/build.ts)', () => {
    const built = listJson('doctrine').filter((f) => !bad.has(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    expect(pub('doctrines.json')).toEqual(built);
  });
});
