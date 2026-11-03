// snapshots.json ships without its note/source prose, which lives in snapshot-notes.json
// (src/ui/snapshotText.ts). Merging must restore the snapshots exactly, or the engine would get
// other data in the browser than in the backtest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../data-pipeline/lib/util';
import { mergeSnapshotText, splitSnapshotText } from '../src/ui/snapshotText';

const pub = (name: string) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', name), 'utf8'));

describe('snapshot prose split', () => {
  it('split then merge restores every value, arrays and nested objects included', () => {
    const snaps = [
      { id: 'a', notes: 'top', x: { low: 1, mid: 2, high: 3, grade: 'B', source: 'doi:1', note: 'n' }, list: [{ k: 1 }, { k: 2, note: 'second' }], tags: ['t'], note: { source: 'nested' } },
      { id: 'b', x: { low: 0, mid: 0, high: 0, grade: 'A' }, source: 7 },
    ];
    const before = structuredClone(snaps);
    const { core, text } = splitSnapshotText(snaps);
    expect(JSON.stringify(core)).not.toContain('second');
    expect(core[1]).toEqual(before[1]); // nothing to strip; a non-string `source` stays
    expect(text.b).toBeUndefined();
    expect(mergeSnapshotText(core, text)).toEqual(before);
    expect(snaps).toEqual(before); // split does not touch its input
  });

  it('the shipped files are one consistent split (stale: run npx tsx data-pipeline/build.ts)', () => {
    const core = pub('snapshots.json');
    const notes = pub('snapshot-notes.json');
    const merged = mergeSnapshotText(structuredClone(core), notes);
    const again = splitSnapshotText(merged);
    expect(again.core).toEqual(core);
    expect(again.text).toEqual(notes);
    expect(JSON.stringify(core)).not.toMatch(/"(note|source|notes)":"/);
  });
});
