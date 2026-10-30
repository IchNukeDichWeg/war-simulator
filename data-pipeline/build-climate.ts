// Builds the Koppen-Geiger climate zone grid used for regional weather (REGIONAL_WEATHER).
//   source : Beck, H.E. et al. 2018, "Present and future Koppen-Geiger climate classification maps
//            at 1-km resolution", Scientific Data 5:180214, doi:10.1038/sdata.2018.214;
//            data doi:10.6084/m9.figshare.6396959 (Beck_KG_V1.zip), CC BY 4.0.
//   input  : Beck_KG_V1_present_0p5.tif (1980-2016, 0.5 deg, 360 x 720, uint8) and legend.txt from
//            the archive. The archive is fetched once (70,961,149 bytes, md5-checked), those two
//            entries are kept in .cache/beck/ and the zip is deleted. The tif is never committed.
// Output: public/data/climate/zones.bin  = u8 per 0.5 deg cell (src/engine/climate.ts layout)
//         public/data/climate/zones.json = source, legend as read, per-zone cell counts, checks
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateRawSync, inflateSync } from 'node:zlib';
import { CLIMATE_H, CLIMATE_RES, CLIMATE_W, CLIMATE_ZONES, climateCell, zoneOfSymbol } from '../src/engine/climate';
import type { ClimateZone } from '../src/types/mechanics';
import { ROOT, Progress } from './lib/util';

const ZIP_URL = 'https://ndownloader.figshare.com/files/12407516';
const ZIP_BYTES = 70_961_149;
const ZIP_MD5 = '69594689d3cdd8323a0f74ce658125a1';
const TIF_NAME = 'Beck_KG_V1_present_0p5.tif';
const LEGEND_NAME = 'legend.txt';
const CACHE = join(ROOT, '.cache', 'beck');
const OUT = join(ROOT, 'public', 'data', 'climate');

// The 30 Koppen-Geiger classes of Beck et al. 2018, Table 1. The legend must list exactly these.
const KG_SYMBOLS = ['Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc',
  'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];
const GROUP_WORD: Record<string, string> = { A: 'Tropical', B: 'Arid', C: 'Temperate', D: 'Cold', E: 'Polar' };

// Spatial check of the legend: interior points far from any zone boundary on every published
// Koppen-Geiger map, one per engine zone.
const CHECKS: { name: string; lat: number; lon: number; zone: ClimateZone }[] = [
  { name: 'Manaus', lat: -3.1, lon: -60.0, zone: 'A' },
  { name: 'Riyadh', lat: 24.7, lon: 46.7, zone: 'BW' },
  { name: 'Central Sahara', lat: 23.0, lon: 10.0, zone: 'BW' },
  { name: 'Niamey', lat: 13.5, lon: 2.1, zone: 'BS' },
  { name: 'Paris', lat: 48.85, lon: 2.35, zone: 'C' },
  { name: 'Moscow', lat: 55.75, lon: 37.6, zone: 'D' },
  { name: 'Greenland ice sheet', lat: 75.0, lon: -40.0, zone: 'E' },
];

async function download(file: string): Promise<void> {
  const res = await fetch(ZIP_URL, { headers: { 'User-Agent': 'multi-era-war-sim data pipeline' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${ZIP_URL}`);
  const total = Number(res.headers.get('content-length')) || ZIP_BYTES;
  const mib = 1 << 20;
  const prog = new Progress('Beck_KG_V1.zip MiB', Math.ceil(total / mib));
  const parts: Buffer[] = [];
  let got = 0, ticked = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    parts.push(Buffer.from(chunk));
    got += chunk.length;
    const whole = Math.min(Math.ceil(total / mib), Math.floor(got / mib));
    if (whole > ticked) { prog.tick(whole - ticked); ticked = whole; }
  }
  if (ticked < Math.ceil(total / mib)) prog.tick(Math.ceil(total / mib) - ticked);
  const buf = Buffer.concat(parts);
  const md5 = createHash('md5').update(buf).digest('hex');
  if (buf.length !== ZIP_BYTES || md5 !== ZIP_MD5) throw new Error(`Beck_KG_V1.zip: ${buf.length} bytes md5 ${md5}, expected ${ZIP_BYTES} bytes md5 ${ZIP_MD5}`);
  writeFileSync(file + '.part', buf);
  renameSync(file + '.part', file);
}

/** Extracts the named entries (matched by basename) from a zip in memory. */
export function unzipEntries(zip: Buffer, names: string[]): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let e = 0; e < count; e++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const method = zip.readUInt16LE(p + 10), crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20), usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    const base = name.split('/').pop()!;
    if (!names.includes(base)) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`zip: ${name} uses compression method ${method}`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`zip: ${name} failed its size/crc check`);
    out.set(base, data);
  }
  for (const n of names) if (!out.has(n)) throw new Error(`zip: no entry ${n}`);
  return out;
}

/** TIFF LZW (MSB-first codes, 9-12 bits, early change). */
function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let bit = 0, width = 9, next = 258, old = -1, op = 0;
  const read = () => {
    let v = 0;
    for (let k = 0; k < width; k++) {
      const b = bit >> 3;
      v = (v << 1) | (b < src.length ? (src[b] >> (7 - (bit & 7))) & 1 : 0);
      bit++;
    }
    return v;
  };
  const emit = (code: number) => {
    const l = len[code];
    for (let k = l - 1, c = code; k >= 0; k--, c = prefix[c]) if (op + k < expected) out[op + k] = suffix[c];
    op += l;
  };
  const add = (p: number, s: number) => {
    if (next >= 4096) return;
    prefix[next] = p; suffix[next] = s; first[next] = first[p]; len[next] = len[p] + 1; next++;
  };
  while (bit + width <= src.length * 8 && op < expected) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { width = 9; next = 258; old = -1; continue; }
    if (old < 0) { emit(code); old = code; continue; }
    if (code < next) { add(old, first[code]); emit(code); } else { add(old, first[old]); emit(next - 1); }
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

function packBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n; k++) out[o++] = src[i++]; } else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n; k++) out[o++] = v; }
  }
  return out;
}

export interface Tiff { width: number; height: number; spp: number; data: Uint8Array; tiepoint?: number[]; scale?: number[] }

/** Minimal baseline TIFF reader: 8-bit samples, chunky, strips or tiles, none/LZW/deflate/PackBits, predictor 1 or 2. */
export function readTiff(buf: Buffer): Tiff {
  const le = buf.toString('latin1', 0, 2) === 'II';
  if (!le && buf.toString('latin1', 0, 2) !== 'MM') throw new Error('tiff: bad byte order');
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error(`tiff: magic ${u16(2)} (BigTIFF is not supported)`);
  const ifd = u32(4);
  const tags = new Map<number, number[]>();
  const size: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4, 11: 4, 12: 8 };
  for (let e = 0, n = u16(ifd); e < n; e++) {
    const o = ifd + 2 + e * 12;
    const tag = u16(o), type = u16(o + 2), count = u32(o + 4);
    const sz = size[type];
    if (!sz) continue;
    const at = sz * count <= 4 ? o + 8 : u32(o + 8);
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      const q = at + k * sz;
      vals.push(type === 3 || type === 8 ? u16(q) : type === 4 || type === 9 ? u32(q) : type === 12 ? f64(q) : type === 11 ? (le ? buf.readFloatLE(q) : buf.readFloatBE(q)) : buf[q]);
    }
    tags.set(tag, vals);
  }
  const one = (t: number, d?: number) => { const v = tags.get(t)?.[0] ?? d; if (v == null) throw new Error(`tiff: missing tag ${t}`); return v; };
  const width = one(256), height = one(257), spp = one(277, 1), comp = one(259, 1), pred = one(317, 1);
  const bits = tags.get(258) ?? [1];
  if (bits.some((b) => b !== 8)) throw new Error(`tiff: ${bits.join(',')} bits per sample, only 8 is supported`);
  if (spp > 1 && one(284, 1) !== 1) throw new Error('tiff: planar configuration 2 is not supported');
  const tiled = tags.has(322);
  const cw = tiled ? one(322) : width, ch = tiled ? one(323) : Math.min(one(278, height), height);
  const offsets = tags.get(tiled ? 324 : 273)!, counts = tags.get(tiled ? 325 : 279)!;
  if (!offsets || !counts) throw new Error('tiff: no strip/tile offsets');
  const across = Math.ceil(width / cw);
  const data = new Uint8Array(width * height * spp);
  for (let c = 0; c < offsets.length; c++) {
    const raw = buf.subarray(offsets[c], offsets[c] + counts[c]);
    const rows = tiled ? ch : Math.min(ch, height - c * ch);
    const expected = cw * rows * spp;
    const px = comp === 1 ? new Uint8Array(raw) : comp === 5 ? lzwDecode(raw, expected)
      : comp === 8 || comp === 32946 ? new Uint8Array(inflateSync(raw)) : comp === 32773 ? packBits(raw, expected) : null;
    if (!px) throw new Error(`tiff: compression ${comp} is not supported`);
    if (pred === 2) for (let r = 0; r < rows; r++) for (let x = spp; x < cw * spp; x++) px[r * cw * spp + x] = (px[r * cw * spp + x] + px[r * cw * spp + x - spp]) & 255;
    else if (pred !== 1) throw new Error(`tiff: predictor ${pred} is not supported`);
    const x0 = tiled ? (c % across) * cw : 0, y0 = tiled ? Math.floor(c / across) * ch : c * ch;
    for (let r = 0; r < rows && y0 + r < height; r++) {
      const w = Math.min(cw, width - x0);
      data.set(px.subarray(r * cw * spp, (r * cw + w) * spp), ((y0 + r) * width + x0) * spp);
    }
  }
  return { width, height, spp, data, tiepoint: tags.get(33922), scale: tags.get(33550) };
}

/** legend.txt lines "    1:  Af   Tropical, rainforest   [0 0 255]" -> code -> symbol, checked against Table 1. */
export function parseLegend(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*:\s*([A-Z][A-Za-z]{1,2})\s+(\S+)/.exec(line);
    if (!m) continue;
    const code = Number(m[1]), sym = m[2], word = m[3].replace(/,$/, '');
    if (map.has(code)) throw new Error(`legend: code ${code} listed twice`);
    if (GROUP_WORD[sym[0]] !== word) throw new Error(`legend: ${code} ${sym} is described as "${word}", expected "${GROUP_WORD[sym[0]]}"`);
    map.set(code, sym);
  }
  const syms = [...map.values()].sort();
  if (syms.join() !== [...KG_SYMBOLS].sort().join()) throw new Error(`legend: symbols ${syms.join(' ')} differ from the 30 classes of Beck et al. 2018 Table 1`);
  return map;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const tifFile = join(CACHE, TIF_NAME), legendFile = join(CACHE, LEGEND_NAME);
  if (!existsSync(tifFile) || !existsSync(legendFile)) {
    const zipFile = join(CACHE, 'Beck_KG_V1.zip');
    if (!existsSync(zipFile)) {
      console.log(`Downloading Beck_KG_V1.zip (${(ZIP_BYTES / (1 << 20)).toFixed(1)} MiB) from ${ZIP_URL}`);
      await download(zipFile);
    }
    const entries = unzipEntries(readFileSync(zipFile), [TIF_NAME, LEGEND_NAME]);
    writeFileSync(tifFile, entries.get(TIF_NAME)!);
    writeFileSync(legendFile, entries.get(LEGEND_NAME)!);
    rmSync(zipFile);
    console.log(`Kept ${TIF_NAME} and ${LEGEND_NAME} in .cache/beck; deleted the zip.`);
  }

  const legend = parseLegend(readFileSync(legendFile, 'utf8'));
  const tif = readTiff(readFileSync(tifFile));
  if (tif.width !== CLIMATE_W || tif.height !== CLIMATE_H || tif.spp !== 1) throw new Error(`${TIF_NAME}: ${tif.width} x ${tif.height} x ${tif.spp}, expected ${CLIMATE_W} x ${CLIMATE_H} x 1`);
  if (tif.scale && (Math.abs(tif.scale[0] - CLIMATE_RES) > 1e-9 || Math.abs(tif.scale[1] - CLIMATE_RES) > 1e-9)) throw new Error(`${TIF_NAME}: pixel scale ${tif.scale}`);
  if (tif.tiepoint && (Math.abs(tif.tiepoint[3] + 180) > 1e-6 || Math.abs(tif.tiepoint[4] - 90) > 1e-6)) throw new Error(`${TIF_NAME}: origin ${tif.tiepoint[3]},${tif.tiepoint[4]}, expected -180,90`);

  const zones = new Uint8Array(CLIMATE_W * CLIMATE_H);
  const unknown = new Map<number, number>();
  const counts = Object.fromEntries(CLIMATE_ZONES.map((z) => [z, 0])) as Record<ClimateZone, number>;
  for (let i = 0; i < zones.length; i++) {
    const v = tif.data[i];
    if (v === 0) continue;
    const sym = legend.get(v);
    const z = sym ? zoneOfSymbol(sym) : null;
    if (!z) { unknown.set(v, (unknown.get(v) ?? 0) + 1); continue; }
    zones[i] = CLIMATE_ZONES.indexOf(z) + 1;
    counts[z]++;
  }
  if (unknown.size) throw new Error(`${TIF_NAME}: values not in the legend: ${[...unknown].map(([v, n]) => `${v} (${n} cells)`).join(', ')}`);
  const checks = CHECKS.map((c) => {
    const v = tif.data[climateCell(c.lat, c.lon)];
    return { ...c, symbol: legend.get(v) ?? '-', got: zones[climateCell(c.lat, c.lon)] ? CLIMATE_ZONES[zones[climateCell(c.lat, c.lon)] - 1] : null };
  });
  for (const c of checks) console.log(`check ${c.name.padEnd(20)} ${c.symbol.padEnd(4)} -> ${c.got ?? '-'} (expected ${c.zone})`);
  const bad = checks.filter((c) => c.got !== c.zone);
  if (bad.length) throw new Error(`legend check failed: ${bad.map((c) => c.name).join(', ')}`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'zones.bin'), zones);
  writeFileSync(join(OUT, 'zones.json'), JSON.stringify({
    source: 'Beck, H.E. et al. 2018, Present and future Koppen-Geiger climate classification maps at 1-km resolution, Scientific Data 5:180214',
    doi: '10.1038/sdata.2018.214', dataDoi: '10.6084/m9.figshare.6396959', license: 'CC BY 4.0', file: TIF_NAME,
    resolutionDeg: CLIMATE_RES, cols: CLIMATE_W, rows: CLIMATE_H, layout: 'u8 per cell, row 0 at 90 N, col 0 at 180 W, value = zone index + 1, 0 = sea',
    zones: CLIMATE_ZONES, legend: Object.fromEntries(legend), cellCounts: counts,
    checks: checks.map((c) => ({ name: c.name, lat: c.lat, lon: c.lon, symbol: c.symbol, zone: c.got })),
  }, null, 1) + '\n');
  console.log(`Wrote climate/zones.bin (${zones.length.toLocaleString('en-US')} cells) and zones.json; land cells per zone ${JSON.stringify(counts)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
