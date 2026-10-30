// Koppen-Geiger climate zones for regional weather (movement.weatherOddsByZone).
// public/data/climate/zones.bin is built by data-pipeline/build-climate.ts from the Beck et al.
// 2018 present-day (1980-2016) map at 0.5 deg (doi:10.1038/sdata.2018.214, CC BY 4.0):
// one u8 per cell, CLIMATE_W x CLIMATE_H, row 0 = 90..89.5 N, col 0 = 180..179.5 W,
// value = index into CLIMATE_ZONES + 1, 0 = no class (sea).
import type { ClimateZone } from '../types/mechanics';

export const CLIMATE_ZONES: readonly ClimateZone[] = ['A', 'BW', 'BS', 'C', 'D', 'E'];
export const CLIMATE_RES = 0.5;
export const CLIMATE_W = 720;
export const CLIMATE_H = 360;
/** Zone used when the grid is missing or no theater land cell is classified (spec: equals the old Berlin table). */
export const CLIMATE_FALLBACK: ClimateZone = 'C';

/** Koppen-Geiger symbol (Af, BWh, Cfb, ET ...) -> engine zone; B splits into BW and BS. */
export function zoneOfSymbol(sym: string): ClimateZone | null {
  if (/^A[fmw]$/.test(sym)) return 'A';
  if (/^BW[hk]$/.test(sym)) return 'BW';
  if (/^BS[hk]$/.test(sym)) return 'BS';
  if (/^C[swf][abc]$/.test(sym)) return 'C';
  if (/^D[swf][abcd]$/.test(sym)) return 'D';
  if (/^E[TF]$/.test(sym)) return 'E';
  return null;
}

export function climateCell(lat: number, lon: number): number {
  const r = Math.min(CLIMATE_H - 1, Math.max(0, Math.floor((90 - lat) / CLIMATE_RES)));
  const c = ((Math.floor((lon + 180) / CLIMATE_RES) % CLIMATE_W) + CLIMATE_W) % CLIMATE_W;
  return r * CLIMATE_W + c;
}

export function zoneAt(zones: Uint8Array, lat: number, lon: number): ClimateZone | null {
  const v = zones[climateCell(lat, lon)];
  return v >= 1 && v <= CLIMATE_ZONES.length ? CLIMATE_ZONES[v - 1] : null;
}

/** Majority zone over the theater's land cells (one sample at each cell centre; ties go to the
 *  earlier zone in CLIMATE_ZONES). zone is null when no land cell falls on a classified cell. */
export function theaterZone(
  zones: Uint8Array,
  grid: { n: number; lat: ArrayLike<number>; lon: ArrayLike<number>; land: ArrayLike<number> },
): { zone: ClimateZone | null; share: number; counts: Record<ClimateZone, number> } {
  const n = new Array<number>(CLIMATE_ZONES.length).fill(0);
  let total = 0;
  for (let i = 0; i < grid.n; i++) {
    if (!grid.land[i]) continue;
    const v = zones[climateCell(grid.lat[i], grid.lon[i])];
    if (v >= 1 && v <= CLIMATE_ZONES.length) { n[v - 1]++; total++; }
  }
  let best = -1;
  for (let z = 0; z < n.length; z++) if (n[z] > 0 && (best < 0 || n[z] > n[best])) best = z;
  const counts = Object.fromEntries(CLIMATE_ZONES.map((z, i) => [z, n[i]])) as Record<ClimateZone, number>;
  return { zone: best < 0 ? null : CLIMATE_ZONES[best], share: best < 0 ? 0 : n[best] / total, counts };
}
