// Save / load scenarios as JSON files and as a shareable URL hash
// (#s=<base64url(deflate-raw(JSON))>).
import type { Scenario } from '../types/scenario';
import { normalizeScenario } from './scenarioDefaults';

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export async function encodeScenario(s: Scenario): Promise<string> {
  const stream = new Blob([JSON.stringify(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64urlEncode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** Most bytes a share link may unpack to. The largest preset is 802 bytes of JSON
 *  (allies-vs-axis-minus-two, measured on public/data/presets.json); 20x that, rounded up
 *  to 16 KiB, leaves room for about 170 Editor overrides. A 44 KB link that unpacked to a
 *  32 MB side name froze the tab (red team C5), so the stream stops at this size. */
export const MAX_SCENARIO_BYTES = 16 * 1024;
/** Most characters of a #s= code: base64 of MAX_SCENARIO_BYTES even if deflate saved nothing. */
const MAX_CODE_CHARS = Math.ceil((MAX_SCENARIO_BYTES * 4) / 3) + 64;
/** Most bytes of a loaded file: the same preset saved by downloadScenario (pretty-printed)
 *  is 1,130 bytes; 20x that, rounded up to 24 KiB. */
export const MAX_FILE_BYTES = 24 * 1024;
/** Input fed to the inflater per pull. Deflate expands at most about 1032:1, so one slice
 *  yields about 1 MB at worst before the byte count is checked again. */
const SLICE = 1024;

/** Inflate `bytes`, giving up as soon as the output passes `max` bytes. */
async function inflateCapped(bytes: Uint8Array, max: number): Promise<string> {
  let off = 0;
  const src = new ReadableStream<BufferSource>({
    pull(c) {
      if (off >= bytes.length) c.close();
      else c.enqueue(bytes.slice(off, (off += SLICE)));
    },
  });
  const reader = src.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let r: ReadableStreamReadResult<Uint8Array>;
    // the browser's inflate error has an empty message; say what went wrong instead
    try { r = await reader.read(); } catch { throw new Error('the link is damaged (its data could not be unpacked)'); }
    if (r.done) break;
    total += r.value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw new Error(`the scenario in the link is larger than ${max / 1024} KB once unpacked, so it was not loaded`);
    }
    parts.push(r.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(out);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch (e) { throw new Error(`not a scenario (invalid JSON: ${(e as Error).message})`); }
}

export async function decodeScenario(code: string): Promise<Scenario> {
  if (code.length > MAX_CODE_CHARS) throw new Error(`the link is too long (${code.length.toLocaleString('en-US')} characters)`);
  let bytes: Uint8Array;
  try { bytes = b64urlDecode(code); } catch { throw new Error('the link is damaged (not valid base64)'); }
  return normalizeScenario(parseJson(await inflateCapped(bytes, MAX_SCENARIO_BYTES)));
}

/** UTF-8 size of a scenario's compact JSON: what a share link unpacks to. */
function scenarioBytes(s: Scenario): number {
  return new TextEncoder().encode(JSON.stringify(s)).byteLength;
}

/** A link for `s`, refused when it would unpack past MAX_SCENARIO_BYTES: the loader would
 *  refuse it, yet "Share link copied" reported success from about 240 overrides on (red
 *  team N2). The thrown message is the toast, so it points to the file path instead. */
export async function shareUrl(s: Scenario): Promise<string> {
  const bytes = scenarioBytes(s);
  if (bytes > MAX_SCENARIO_BYTES) {
    throw new Error(`the scenario is ${Math.ceil(bytes / 1024)} KB, more than the ${MAX_SCENARIO_BYTES / 1024} KB a share link can carry, so no link was copied. Use Save to keep it as a file (up to ${MAX_FILE_BYTES / 1024} KB) instead`);
  }
  const code = await encodeScenario(s);
  return `${location.origin}${location.pathname}${location.search}#s=${code}`;
}

export async function scenarioFromHash(): Promise<Scenario | null> {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeScenario(m[1]);
}

/** The text Save writes: pretty-printed to stay readable, compact when the pretty form would
 *  pass MAX_FILE_BYTES. Pretty-printing adds 40 to 52% to an override-heavy scenario, so a
 *  scenario just past the share link cap, which the share toast sends to Save, could
 *  otherwise be saved as a file that Load then refuses. */
export function scenarioFileText(s: Scenario): string {
  const pretty = JSON.stringify(s, null, 2);
  if (new TextEncoder().encode(pretty).byteLength <= MAX_FILE_BYTES) return pretty;
  const compact = JSON.stringify(s);
  const bytes = new TextEncoder().encode(compact).byteLength;
  if (bytes > MAX_FILE_BYTES) throw new Error(`the scenario is ${Math.ceil(bytes / 1024)} KB; a scenario file is at most ${MAX_FILE_BYTES / 1024} KB`);
  return compact;
}

export function downloadScenario(s: Scenario) {
  const blob = new Blob([scenarioFileText(s)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.name || 'scenario').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function uploadScenario(): Promise<Scenario> {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return reject(new Error('no file'));
      if (f.size > MAX_FILE_BYTES) return reject(new Error(`the file is ${Math.ceil(f.size / 1024).toLocaleString('en-US')} KB; a scenario file is at most ${MAX_FILE_BYTES / 1024} KB`));
      try { resolve(normalizeScenario(parseJson(await f.text()))); } catch (e) { reject(e); }
    };
    inp.click();
  });
}
