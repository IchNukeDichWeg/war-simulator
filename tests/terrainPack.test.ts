// The browser loads terrain/grid.pack.gz, the engine in Node reads terrain/grid.bin. They must hold
// the same grid, or the app would simulate on other terrain than the backtest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../data-pipeline/lib/util';
import { gunzipBody, packTerrain, unpackTerrain } from '../src/ui/terrainPack';

const dir = join(ROOT, 'public', 'data', 'terrain');

describe('terrain/grid.pack.gz', () => {
  const raw = new Uint8Array(readFileSync(join(dir, 'grid.bin')));
  const gz = readFileSync(join(dir, 'grid.pack.gz'));

  it('unpacks to grid.bin byte for byte (stale: run npx tsx data-pipeline/build.ts)', () => {
    expect(Buffer.from(unpackTerrain(gunzipSync(gz))).equals(Buffer.from(raw))).toBe(true);
  });

  it('pack and unpack are inverse', () => {
    const packed = packTerrain(raw);
    expect(Buffer.from(packed).equals(Buffer.from(raw))).toBe(false);
    expect(Buffer.from(unpackTerrain(packed)).equals(Buffer.from(raw))).toBe(true);
  });

  it('gunzipBody inflates gzip and passes an already inflated body through', async () => {
    const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const inflated = await gunzipBody(ab(gz));
    expect(Buffer.from(inflated).equals(Buffer.from(packTerrain(raw)))).toBe(true);
    const plain = packTerrain(raw);
    expect(await gunzipBody(ab(plain))).toEqual(plain);
  });
});
