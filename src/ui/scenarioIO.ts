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

export async function decodeScenario(code: string): Promise<Scenario> {
  const bytes = b64urlDecode(code);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return normalizeScenario(JSON.parse(await new Response(stream).text()));
}

export async function shareUrl(s: Scenario): Promise<string> {
  const code = await encodeScenario(s);
  return `${location.origin}${location.pathname}${location.search}#s=${code}`;
}

export async function scenarioFromHash(): Promise<Scenario | null> {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeScenario(m[1]);
}

export function downloadScenario(s: Scenario) {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
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
      try { resolve(normalizeScenario(JSON.parse(await f.text()))); } catch (e) { reject(e); }
    };
    inp.click();
  });
}
