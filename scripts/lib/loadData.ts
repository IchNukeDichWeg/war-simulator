// Node loader for the runtime data in public/data (or another directory via --data).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EngineData } from '../../src/engine/protocol';
import type { BattleCase } from '../../src/types/mechanics';
import type { Scenario } from '../../src/types/scenario';

export function dataDir(argv: string[]): string {
  const i = argv.indexOf('--data');
  return resolve(i >= 0 ? argv[i + 1] : join(import.meta.dirname, '..', '..', 'public', 'data'));
}

function readJson<T>(dir: string, file: string, fallback?: T): T {
  const p = join(dir, file);
  if (!existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${p} (run the data pipeline: npx tsx data-pipeline/build.ts)`);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

export function loadEngineData(dir: string): EngineData {
  const bin = readFileSync(join(dir, 'terrain', 'grid.bin'));
  const terrain = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const cf = join(dir, 'climate', 'zones.bin');
  const cb = existsSync(cf) ? readFileSync(cf) : null;
  const climate = cb ? (cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength) as ArrayBuffer) : undefined;
  return {
    snapshots: readJson(dir, 'snapshots.json'),
    doctrines: readJson(dir, 'doctrines.json', []),
    mechanics: readJson(dir, 'mechanics.json'),
    borders: readJson(dir, 'borders.json', {}),
    terrain,
    climate,
  };
}

export function loadBattles(dir: string): BattleCase[] {
  return readJson(dir, 'battles.json');
}

export function loadPresets(dir: string): Scenario[] {
  return readJson(dir, 'presets.json', []);
}

export function arg(argv: string[], name: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}

/** Progress line: count, percent, rate, elapsed, ETA. \r on a TTY, one plain line every `every` items otherwise. */
export class Progress {
  private t0 = Date.now();
  private lastPlain = 0;
  constructor(private total: number, private label: string, private every = Math.max(1, Math.floor(total / 20))) {}
  tick(done: number, extra = ''): void {
    const el = (Date.now() - this.t0) / 1000;
    const rate = done / Math.max(el, 1e-6);
    const eta = rate > 0 ? (this.total - done) / rate : 0;
    const line = `${this.label} ${done}/${this.total} ${((100 * done) / this.total).toFixed(1)}% ${rate.toFixed(2)}/s elapsed ${fmt(el)} eta ${fmt(eta)}${extra ? ' ' + extra : ''}`;
    if (process.stdout.isTTY) {
      process.stdout.write('\r' + line.padEnd(110));
      if (done >= this.total) process.stdout.write('\n');
    } else if (done - this.lastPlain >= this.every || done >= this.total || done === 1) {
      this.lastPlain = done;
      console.log(line);
    }
  }
}

export function fmt(s: number): string {
  if (!isFinite(s)) return '?';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.round(s % 60).toString().padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60).toString().padStart(2, '0')}m`;
}
