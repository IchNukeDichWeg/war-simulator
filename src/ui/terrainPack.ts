// Packed form of public/data/terrain/grid.bin for the browser: terrain/grid.pack.gz.
// grid.bin is planar (class u8, flags u8, elev i16le, relief u16le, each GRID_W x GRID_H). The
// pack keeps the two u8 planes and splits each 16-bit plane into its low bytes then its high
// bytes, so the slowly varying high bytes sit together, then gzips it. Measured on the shipped
// grid (6,220,800 bytes): gzip -9 alone 2,883,373, byte-split + gzip -9 2,278,168, brotli on the
// split 2,129,539 (not used: DecompressionStream has no brotli in every browser). Row deltas on
// top of the split made it larger (2,313,757). The transform is lossless; tests/terrainPack.test.ts
// checks that the shipped pack unpacks to grid.bin byte for byte.
import { GRID_H, GRID_W } from '../engine/terrainClasses';

const N = GRID_W * GRID_H;
export const TERRAIN_BYTES = N * 6;

export function packTerrain(raw: Uint8Array): Uint8Array {
  if (raw.length !== TERRAIN_BYTES) throw new Error(`terrain grid has ${raw.length} bytes, expected ${TERRAIN_BYTES}`);
  const out = new Uint8Array(TERRAIN_BYTES);
  out.set(raw.subarray(0, 2 * N));
  for (const off of [2 * N, 4 * N]) {
    for (let i = 0; i < N; i++) { out[off + i] = raw[off + 2 * i]; out[off + N + i] = raw[off + 2 * i + 1]; }
  }
  return out;
}

export function unpackTerrain(packed: Uint8Array): ArrayBuffer {
  if (packed.length !== TERRAIN_BYTES) throw new Error(`packed terrain has ${packed.length} bytes, expected ${TERRAIN_BYTES}`);
  const out = new Uint8Array(TERRAIN_BYTES);
  out.set(packed.subarray(0, 2 * N));
  for (const off of [2 * N, 4 * N]) {
    for (let i = 0; i < N; i++) { out[off + 2 * i] = packed[off + i]; out[off + 2 * i + 1] = packed[off + N + i]; }
  }
  return out.buffer;
}

/** Inflate a gzip body in the browser. A host that serves .gz files with Content-Encoding: gzip
 *  has already inflated it, so a body without the gzip magic bytes is returned as is. */
export async function gunzipBody(buf: ArrayBuffer): Promise<Uint8Array> {
  const b = new Uint8Array(buf);
  if (b.length < 2 || b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
