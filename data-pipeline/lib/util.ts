// Shared pipeline helpers: cached downloads and a TTY-aware progress bar.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
export const CACHE = join(ROOT, '.cache');

/** Fetch a URL once and keep it under .cache so pipeline re-runs are offline and reproducible. */
export async function cachedFetch(url: string, retries = 3): Promise<Buffer> {
  const key = createHash('sha1').update(url).digest('hex');
  const file = join(CACHE, key.slice(0, 2), key);
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(dirname(file), { recursive: true });
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'multi-era-war-sim data pipeline' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Progress bar with count, percent, rate, elapsed and ETA. Plain lines when not a TTY. */
export class Progress {
  private start = Date.now();
  private done = 0;
  private lastPlain = 0;
  constructor(private label: string, private total: number) {}
  tick(n = 1) {
    this.done += n;
    const el = (Date.now() - this.start) / 1000;
    const rate = this.done / Math.max(el, 1e-3);
    const eta = (this.total - this.done) / Math.max(rate, 1e-9);
    const pct = ((100 * this.done) / this.total).toFixed(1);
    const line = `${this.label} ${this.done}/${this.total} ${pct}% ${rate.toFixed(1)}/s elapsed ${fmt(el)} eta ${fmt(eta)}`;
    if (process.stdout.isTTY) {
      const w = 24;
      const filled = Math.round((w * this.done) / this.total);
      process.stdout.write(`\r[${'#'.repeat(filled)}${'.'.repeat(w - filled)}] ${line}   `);
      if (this.done >= this.total) process.stdout.write('\n');
    } else if (this.done >= this.total || Date.now() - this.lastPlain > 5000) {
      this.lastPlain = Date.now();
      console.log(line);
    }
  }
}

function fmt(s: number) {
  if (!isFinite(s)) return '?';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${Math.round(s % 60)}s` : `${s.toFixed(0)}s`;
}

/** Run async jobs with bounded concurrency. */
export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
