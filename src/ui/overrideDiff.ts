// What an Editor override changed: the field's readable name, its researched value and the
// difference. Pure, tested in tests/overrideDiff.test.ts. The scenario format is untouched:
// an override stays { snapshotId, path, value }.
import type { Est, Override, Snapshot } from '../types/schema';

/** Group and readable label of a field path (no ".mid"), as the Editor lists it. */
export function fieldLabel(path: string): { group: string; label: string } {
  const p = path.split('.');
  let group = p[0];
  if (p[1] === 'forces') group = 'forces';
  if (p[1] === 'production') group = 'production';
  const label = group === 'forces' || group === 'production' ? p.slice(2).join(' ') : p.slice(1).join(' ');
  return { group, label: label.replace(/_/g, ' ') };
}

const isEst = (o: unknown): o is Est =>
  !!o && typeof o === 'object' && 'mid' in o && 'low' in o && 'high' in o && 'grade' in o;

/** The Est at a field path (no ".mid"), walking own properties only. */
export function estAt(s: Snapshot, path: string): Est | undefined {
  let o: unknown = s;
  for (const k of path.split('.')) {
    if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return isEst(o) ? o : undefined;
}

export interface OverrideRow {
  ov: Override;
  /** Field path without ".mid". */
  field: string;
  group: string;
  label: string;
  /** Researched value; undefined when the snapshot is not loaded or has no such field. */
  base?: Est;
  /** value / base.mid; undefined when there is no base or its mid is 0. */
  ratio?: number;
  outOfRange: boolean;
}

export function describeOverride(ov: Override, snap: Snapshot | undefined): OverrideRow {
  const field = ov.path.replace(/\.mid$/, '');
  return overrideRow(ov, snap ? estAt(snap, field) : undefined);
}

/** The row for an override whose researched Est is already at hand (the Editor's own rows). */
export function overrideRow(ov: Override, base: Est | undefined): OverrideRow {
  const field = ov.path.replace(/\.mid$/, '');
  return {
    ov, field, ...fieldLabel(field), base,
    ratio: base && base.mid !== 0 ? ov.value / base.mid : undefined,
    outOfRange: !!base && (ov.value < base.low || ov.value > base.high),
  };
}

/** "+25%", "-60%", "x12" past +900%, "from 0" when the researched value is zero. */
export function deltaLabel(r: OverrideRow): string {
  if (!r.base) return '';
  if (r.ratio === undefined) return r.ov.value === 0 ? 'no change' : 'from 0';
  if (r.ratio >= 10) return `x${Number(r.ratio.toPrecision(2))}`;
  const pct = (r.ratio - 1) * 100;
  const abs = Math.abs(pct);
  if (abs < 1e-9) return 'no change';
  const shown = abs >= 10 ? Math.round(abs) : Number(abs.toPrecision(2));
  return `${pct < 0 ? '-' : '+'}${shown}%`;
}
