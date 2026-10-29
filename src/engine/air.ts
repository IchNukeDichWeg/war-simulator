// Air war (ENGINE.md section 7): theater air forces per side from air tech 7.
// Fighters contest the air; strike aircraft, helicopters and drones fly battle
// support (added to battle power) and interdiction (cuts enemy supply).
import type { Ctx } from './ctx';
import { byTech, clamp, matrix } from './mech';
import { RI, ROLES, STRIKE_ROLES, NR } from './roles';
import { AIR_BATTLE_SHARE, AIR_MIN_TECH } from './constants';
import { haversineKm } from './grid';

function lossFrac(ctx: Ctx, side: 0 | 1): number {
  const { S, st } = ctx;
  const e = (1 - side) as 0 | 1;
  const pe = S.poolTech[e];
  let ad = -Infinity;
  if (st.air[e][RI.aircraft_fighter] > 0) ad = Math.max(ad, pe.air);
  // ground air defence: any air_defense platforms on the map, or weapons tech of the air age
  let adPlatforms = 0;
  const F = st.F;
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.side[f] === e) adPlatforms += F.counts[f * NR + RI.air_defense];
  if (adPlatforms > 0 || pe.weapons >= AIR_MIN_TECH) ad = Math.max(ad, pe.weapons);
  if (ad === -Infinity) return 0;
  const idx = clamp(Math.round(ad - S.poolTech[side].air), -5, 5) + 5;
  return S.m.air.lossPerSortie[idx].mid;
}

/** Runs after battle detection: contests the air and allocates battle support. */
export function airPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  st.interdiction = [0, 0];
  if (!S.scenario.rules.air) { st.airSup = [0, 0]; st.airHolds = [false, false]; return; }
  const m = S.m.air;
  const fp: [number, number] = [0, 0];
  const sorties: [number, number] = [0, 0];
  const active: [boolean, boolean] = [false, false];
  for (const s of [0, 1] as const) {
    const pt = S.poolTech[s];
    let n = 0;
    for (const r of [RI.aircraft_fighter, ...STRIKE_ROLES]) n += st.air[s][r];
    active[s] = pt.air >= AIR_MIN_TECH && n > 0.5;
    if (!active[s]) continue;
    sorties[s] = byTech(m.sortiesPerAircraftDay, pt.air);
    fp[s] = st.air[s][RI.aircraft_fighter] * sorties[s] * byTech(S.m.lethality.tli.aircraft_fighter, pt.air) * pt.q[RI.aircraft_fighter] * pt.t[RI.aircraft_fighter];
  }
  if (!active[0] && !active[1]) { st.airSup = [0, 0]; st.airHolds = [false, false]; return; }
  const lf: [number, number] = [lossFrac(ctx, 0), lossFrac(ctx, 1)];
  // fighter attrition
  for (const s of [0, 1] as const) {
    if (!active[s]) continue;
    const e = 1 - s;
    if (fp[e] <= 0 && lf[s] <= 0) continue;
    const lost = Math.min(st.air[s][RI.aircraft_fighter] * 0.5, st.air[s][RI.aircraft_fighter] * sorties[s] * lf[s]);
    st.air[s][RI.aircraft_fighter] -= lost;
    st.platformLosses[s] += lost;
  }
  const tot = fp[0] + fp[1];
  st.airSup = tot > 0 ? [fp[0] / tot, fp[1] / tot] : [0, 0];
  const thr = m.superiorityRatioThreshold.mid;
  st.airHolds = [0, 1].map((s) => fp[s] > 0 && (fp[1 - s] <= 0 || fp[s] / fp[1 - s] > thr)) as [boolean, boolean];
  st.acc.airSupSum += st.airSup[0] - st.airSup[1];
  st.acc.airDays++;
  // strike sorties
  for (const s of [0, 1] as const) {
    if (!active[s]) continue;
    const pt = S.poolTech[s];
    let strike = 0, tliSum = 0;
    for (const r of STRIKE_ROLES) {
      const c = st.air[s][r];
      strike += c;
      tliSum += c * byTech(S.m.lethality.tli[ROLES[r]], pt.air) * pt.q[r] * pt.t[r];
    }
    if (strike <= 0) continue;
    const perSortieTli = tliSum / strike;
    const total = strike * sorties[s];
    const contested = !st.airHolds[1 - s];
    if (!contested || fp[1 - s] <= 0) st.interdiction[s] = total * (1 - AIR_BATTLE_SHARE);
    // battle support within combat radius of own bases
    const radius = byTech(m.combatRadiusKm, pt.air);
    const bases: number[] = [];
    const src = S.sources[s];
    for (let i = 0; i < src.cell.length; i++) if (st.control[src.cell[i]] === s) bases.push(src.cell[i]);
    const g = S.grid;
    const elig: number[] = [];
    let wsum = 0;
    for (const b of sc.battles) {
      if (!b.parts[s].length) continue;
      let ok = false;
      for (const c of bases) if (haversineKm(g.lat[c], g.lon[c], g.lat[b.cell], g.lon[b.cell]) <= radius) { ok = true; break; }
      if (!ok) continue;
      elig.push(b.id);
      wsum += b.parts[1 - s].length;
    }
    const supportSorties = total * AIR_BATTLE_SHARE;
    for (const id of elig) {
      const b = sc.battles[id];
      const share = b.parts[1 - s].length / (wsum || 1);
      const so = supportSorties * share;
      // enemy profile for OLI: dispersion and armor of the formations hit
      let disp = 0, armor = 0, w = 0;
      for (const f of b.parts[1 - s]) {
        const mr = S.members[st.F.member[f]];
        const fw = Math.max(st.F.curW[f], 1e-9);
        disp += mr.dispersion * fw; armor += mr.tech.armor * fw; w += fw;
      }
      disp = w > 0 ? disp / w : 1;
      armor = w > 0 ? armor / w : 0;
      b.airSorties[s] = so;
      b.airPow[s] = so * perSortieTli / Math.max(1e-9, disp) * matrix(S.m.lethality.armorMatrix, pt.air, armor) * pt.cmd;
      b.airLossFrac[s] = lf[s];
    }
  }
}
