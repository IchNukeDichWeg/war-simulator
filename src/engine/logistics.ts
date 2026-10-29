// Logistics, attrition and daily morale (ENGINE.md section 8).
import type { Ctx } from './ctx';
import { seasonIdx } from './ctx';
import { clamp } from './mech';
import { dijkstra } from './grid';
import { T } from './terrainClasses';
import { IS_P, LC, NR } from './roles';
import { Mode } from './state';
import { UnitStatus } from './protocol';
import { isRoad } from './movement';
import { lossPersonnel, withdrawPersonnel } from './formations';
import { blockaded, seaFactor } from './naval';
import { DESERTION_MORALE, HOSPITAL_ADMISSIONS_RETURN, RETURN_TO_DUTY_DAYS, ROUT_FLEE_DAYS, SUPPLY_FALLOFF_MULT } from './constants';

/**
 * Supply network cost field per side over own and neutral land from active sources,
 * in km of open country: cost per km = plainsMove / (terrain x road), so supplyRangeKm
 * reads as km over plains, roads stretch it and rough ground shortens it. (Raw
 * 1 / (terrain x road) put every plains km at 1/0.6 = 1.7 'km' and cut ranges by 40%.)
 */
export function supplyField(ctx: Ctx, side: 0 | 1): void {
  const { S, st, sc } = ctx;
  const g = S.grid;
  const inv = sc.tmpN;
  const road = S.m.movement.roadBonus.mid;
  const ref = S.terrMove[T.plains];
  for (let c = 0; c < g.n; c++) {
    const ctl = st.control[c];
    if (!g.land[c] || (ctl !== side && ctl !== 255)) { inv[c] = Infinity; continue; }
    const t = S.terrMove[g.cls[c]] * (isRoad(ctx, side, c) ? road : 1);
    inv[c] = t > 0 ? ref / t : Infinity;
  }
  const src = S.sources[side];
  const cells = sc.tmpSrc;
  const costs: number[] = [];
  let k = 0;
  const idx: number[] = [];
  for (let i = 0; i < src.cell.length; i++) {
    const c = src.cell[i];
    const ctl = st.control[c];
    const ok = src.place[i] !== -1 ? ctl === side : ctl !== 1 - side;
    if (!ok || inv[c] === Infinity) continue;
    if (src.sea[i] && blockaded(ctx, side) && src.place[i] < 0) continue;
    cells[k++] = c;
    costs.push(src.cost[i]);
    idx.push(i);
  }
  const dist = st.supplyDist[side], out = st.supplySrc[side];
  dijkstra(g, sc.heap, inv, null, cells.subarray(0, k), costs, dist, out);
  // map local source numbers back to SourceList indices
  for (let c = 0; c < g.n; c++) if (out[c] >= 0) out[c] = idx[out[c]];
}

export function logisticsPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const m = S.m;
  supplyField(ctx, 0);
  supplyField(ctx, 1);
  const supplyOn = S.scenario.rules.supply;
  const season = seasonIdx(ctx);
  const winter = season === 3, summer = season === 1;
  const forageSeason = winter ? m.logistics.forageWinterFactor.mid : 1;
  const foodKg = m.logistics.foodKgPerPersonDay.mid;
  const fodderKg = m.logistics.fodderKgPerAnimalDay.mid;
  const fuel = m.logistics.fuelTonsPerVehicleDay.mid;
  const depletion = m.logistics.forageDepletion.mid;
  const friction = m.c2.coalitionFriction.mid;
  // harvest: forage regrows at the start of each summer (one growing season per year)
  if (summer && seasonIdx(ctx, st.day - 1) !== 1) st.forage.fill(1);
  sc.demand.fill(0);
  const touched: number[] = [];
  // pass 1: needs, forage, wanted network delivery
  for (let f = 0; f < F.n; f++) {
    sc.need[f] = 0; sc.want[f] = 0; sc.take[f] = 0;
    if (!F.alive[f] || !F.onMap[f]) continue;
    if (!supplyOn) continue;
    const side = F.side[f] as 0 | 1;
    const mr = S.members[F.member[f]];
    const P = F.personnel[f];
    const o = f * NR;
    let vehicles = 0;
    for (let r = 0; r < NR; r++) if (mr.vehicle[r]) vehicles += F.counts[o + r];
    const animals = (P / 1000) * mr.animalsPer1000;
    const foodT = (P * foodKg + animals * fodderKg) / 1000;
    let need = Math.max((P / 1000) * mr.supplyPer1000, foodT);
    if (F.fought[f]) need += (P / 1000) * mr.ammoPer1000;
    if (F.fought[f] || F.moved[f]) need += vehicles * fuel;
    if (need <= 0) continue;
    sc.need[f] = need;
    const c = F.cell[f];
    // forage
    const want = foodT * mr.forageDep;
    if (want > 0) {
      const avail0 = S.forageYield[g.cls[c]] * g.area[c] * forageSeason * st.forage[c] * foodKg / 1000;
      if (sc.forageTaken[c] === 0) touched.push(c);
      const avail = Math.max(0, avail0 - sc.forageTaken[c]);
      const take = Math.min(want, avail);
      sc.take[f] = take;
      sc.forageTaken[c] += take;
    }
    // network
    const d = st.supplyDist[side][c];
    const si = st.supplySrc[side][c];
    if (d < Infinity && si >= 0) {
      // Full delivery within supplyRangeKm ("distance an army can operate beyond its supply
      // base"), falling linearly to zero at SUPPLY_FALLOFF_MULT x range. ENGINE.md first had
      // 1 - d/range, which starved armies fighting on their own territory (see ENGINE.md 8).
      let frac = clamp((SUPPLY_FALLOFF_MULT * mr.supplyRangeKm - d) / ((SUPPLY_FALLOFF_MULT - 1) * mr.supplyRangeKm), 0, 1);
      const src = S.sources[side];
      if (src.member[si] !== mr.idx) frac *= clamp(1 - friction, 0, 1);
      if (src.sea[si]) frac *= seaFactor(ctx, side);
      if (st.airHolds[1 - side] && st.interdiction[1 - side] > 0) frac *= m.air.airSuperioritySupplyFactor.mid;
      const w = Math.min(Math.max(0, need - sc.take[f]), need * frac);
      sc.want[f] = w;
      sc.demand[si] += w;
    }
  }
  // forage depletion
  for (const c of touched) {
    const avail0 = S.forageYield[g.cls[c]] * g.area[c] * forageSeason * st.forage[c] * foodKg / 1000;
    if (avail0 > 0) st.forage[c] *= 1 - depletion * clamp(sc.forageTaken[c] / avail0, 0, 1);
    sc.forageTaken[c] = 0;
  }
  // pass 2: throughput limits, stock, supply fraction, attrition, morale
  const diseaseCause = LC.disease, expCause = LC.exposure, starvCause = LC.starvation, desCause = LC.desertion;
  const winterExp = m.attrition.winterExposure.mid, desertHeat = m.attrition.desertHeat.mid;
  const starvMult = m.attrition.starvationMultiplier.mid, rtd = m.attrition.returnToDuty.mid;
  const slot = st.day % RETURN_TO_DUTY_DAYS;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f]) continue;
    const side = F.side[f] as 0 | 1;
    const mr = S.members[F.member[f]];
    let shortfall = 0;
    if (supplyOn && sc.need[f] > 0) {
      const si = st.supplySrc[side][F.cell[f]];
      let got = sc.take[f];
      if (sc.want[f] > 0 && si >= 0) {
        const src = S.sources[side];
        const cap = src.cap[si] * (src.sea[si] ? seaFactor(ctx, side) : 1);
        const scale = sc.demand[si] > cap ? cap / sc.demand[si] : 1;
        got += sc.want[f] * scale;
      }
      const frac = clamp(got / sc.need[f], 0, 1);
      const avail = frac + F.stock[f];
      const supplied = Math.min(1, avail);
      F.stock[f] = Math.min(mr.carriedDays, avail - supplied);
      F.supply[f] = supplied;
      shortfall = 1 - supplied;
    } else {
      F.supply[f] = 1;
      F.stock[f] = mr.carriedDays;
    }
    F.noSupplyDays[f] = F.supply[f] < 0.5 ? Math.min(65535, F.noSupplyDays[f] + 1) : 0;
    st.acc.shortfallDays[side] += shortfall;
    st.acc.formationDays[side]++;
    // non-battle attrition (personnel only)
    const P = F.personnel[f];
    if (P > 0) {
      const c = F.cell[f];
      const cls = S.grid.cls[c];
      const W = winter && cls !== T.urban && S.placeAt[c] < 0 ? winterExp : 1;
      const D = summer && cls === T.desert ? desertHeat : 1;
      const Sv = supplyOn ? 1 + (starvMult - 1) * shortfall : 1;
      const base = P * mr.disease;
      const exposure = base * (W * D - 1);
      const starvation = base * W * D * (Sv - 1);
      const desertion = F.morale[f] <= DESERTION_MORALE ? P * mr.desertion : 0;
      const parts: [number, number][] = [[base, diseaseCause], [exposure, expCause], [starvation, starvCause], [desertion, desCause]];
      let returning = 0;
      for (const [amt, cause] of parts) {
        if (!(amt > 0) || !F.alive[f]) continue;
        if (HOSPITAL_ADMISSIONS_RETURN && cause !== desCause) {
          // admissions: the returnToDuty share is in hospital, the rest are deaths and discharges
          const lost = lossPersonnel(ctx, f, amt * (1 - rtd), cause);
          st.acc.nonBattle[side] += lost;
          if (F.alive[f]) returning += withdrawPersonnel(ctx, f, amt * rtd, cause);
        } else {
          const lost = lossPersonnel(ctx, f, amt, cause);
          st.acc.nonBattle[side] += lost;
          if (cause !== desCause) returning += lost * rtd;
        }
      }
      if (returning > 0) {
        st.members[mr.idx].returns[slot] += returning;
        if (HOSPITAL_ADMISSIONS_RETURN) st.hospital[side] += returning;
      }
    }
    if (!F.alive[f]) continue;
    // morale
    if (!F.fought[f]) F.morale[f] = Math.min(mr.morale0, F.morale[f] + m.morale.dailyRecovery.mid);
    F.morale[f] = clamp(F.morale[f] - m.morale.supplyShortfallPenalty.mid * shortfall, 0, 1);
    // rout -> rally
    if (F.mode[f] === Mode.Rout) {
      F.routDays[f]++;
      if (F.routDays[f] >= ROUT_FLEE_DAYS || st.supplyDist[side][F.cell[f]] === 0) { F.mode[f] = Mode.Retreat; F.status[f] = UnitStatus.Idle; }
    }
    if (!F.fought[f]) F.engagedDays[f] = 0;
    if (!F.fought[f] && !F.moved[f] && F.status[f] !== UnitStatus.Besieging) {
      F.status[f] = S.placeAt[F.cell[f]] >= 0 && st.control[F.cell[f]] === side ? UnitStatus.Garrison : UnitStatus.Idle;
    }
  }
  void IS_P;
}
