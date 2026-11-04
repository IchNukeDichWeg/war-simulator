// Production, mobilization and arrivals (ENGINE.md sections 2.6 and 9).
// Personnel entering the theater after day 0 pass through a per-member depot and
// are counted in state.arrivals, so start + arrivals = current + losses + hospital holds.
import type { Ctx } from './ctx';
import { addEvent } from './ctx';
import { IS_AIR, IS_LAND, IS_NAVAL, IS_P, NR, RI } from './roles';
import { CREWED_FORMATIONS, HOSPITAL_ADMISSIONS_RETURN, MAX_FORMATIONS_PER_MEMBER, RECRUIT_BATCH_DAYS, RETURN_RING_DAYS, SUBDAY_REINFORCEMENTS } from './constants';
import { blockaded } from './naval';
import { refreshFormation, spawnFormation } from './formations';
import { haversineKm } from './grid';
import { UnitStatus } from './protocol';

function addPersonnelToDepot(ctx: Ctx, mi: number, amount: number): void {
  if (!(amount > 0)) return;
  const mr = ctx.S.members[mi];
  const d = ctx.st.members[mi].depot;
  for (let r = 0; r < NR; r++) if (IS_P[r]) d[r] += amount * mr.pMix[r];
  ctx.st.arrivals[mr.side] += amount;
  ctx.st.members[mi].fielded += amount;
}

/** Spawn cell for member mi today: first spawn cell not held or occupied by the enemy. */
function spawnCellFor(ctx: Ctx, mi: number): number {
  const { S, st, sc } = ctx;
  const mr = S.members[mi];
  const enemy = 1 - mr.side;
  // least crowded usable spawn cell (ties: listed order, capital first)
  let best = -1, bo = Infinity;
  for (const c of mr.spawnCells) {
    if (c < 0) continue;
    if (st.control[c] === enemy || sc.occ[enemy][c] > 0) continue;
    if (sc.occ[mr.side][c] < bo) { bo = sc.occ[mr.side][c]; best = c; }
  }
  return best;
}

/** The member's crewed land formation on the map nearest its spawn cell, or -1. */
function nearestCrewed(ctx: Ctx, mi: number): number {
  const { S, st } = ctx;
  const F = st.F, g = S.grid;
  const at = spawnCellFor(ctx, mi);
  const ref = at >= 0 ? at : S.members[mi].spawnCells.find((c) => c >= 0) ?? -1;
  if (ref < 0) return -1;
  let best = -1, bd = Infinity;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.member[f] !== mi || F.personnel[f] < 0.5 || !g.land[F.cell[f]]) continue;
    const dist = haversineKm(g.lat[ref], g.lon[ref], g.lat[F.cell[f]], g.lon[F.cell[f]]);
    if (dist < bd) { bd = dist; best = f; }
  }
  return best;
}

/** Hand the depot's land platforms to the member's crewed formation nearest its spawn cell (kept in
 *  the depot while the member has none on the map). */
function mergePlatforms(ctx: Ctx, mi: number): void {
  const d = ctx.st.members[mi].depot;
  const best = nearestCrewed(ctx, mi);
  if (best < 0) return;
  const F = ctx.st.F;
  const o = best * NR;
  for (let r = 0; r < NR; r++) if (IS_LAND[r] && !IS_P[r] && d[r] > 0) { F.counts[o + r] += d[r]; d[r] = 0; }
  refreshFormation(ctx, best);
}

function flushDepot(ctx: Ctx, mi: number, force: boolean): void {
  const { S, st } = ctx;
  const mr = S.members[mi];
  const ms = st.members[mi];
  const d = ms.depot;
  let p = 0, nland = 0;
  for (let r = 0; r < NR; r++) { if (IS_P[r]) p += d[r]; else if (IS_LAND[r]) nland += d[r]; }
  if (p <= 0 && nland < 1) return;
  // platforms without personnel join a crewed formation of the member instead of forming a
  // crewless one (QA round 2: US platform-only formations won 18 battles in japan-vs-usa-1941)
  if (CREWED_FORMATIONS && p < 0.5) { if (force && nland >= 1) mergePlatforms(ctx, mi); return; }
  if (!(p >= mr.formationSize || (force && (p >= 0.25 * mr.formationSize || nland >= 1)))) return;
  if (mr.entryBySea && (blockaded(ctx, mr.side) || st.day < st.nextLiftDay[mi])) return;
  const cell = spawnCellFor(ctx, mi);
  if (cell < 0) return;
  // overseas members ship at most one lift per round trip
  const share = mr.entryBySea && mr.lift > 0 ? Math.min(1, mr.lift / Math.max(1e-9, p)) : 1;
  if (mr.entryBySea) st.nextLiftDay[mi] = st.day + Math.max(1, Math.ceil(mr.roundTripDays));
  const ship = p * share;
  // one formation per formationSize of personnel, but the member never holds more than
  // MAX_FORMATIONS_PER_MEMBER alive, the same cap the day-0 seeds use. Without it the hospital
  // returns and recruits of a 1e9-strong army added about 500 formations a day until V8 aborted
  // (red team C2). Below the cap nothing changes; at it the draft joins the nearest crewed
  // formation, so the extra men are fielded in larger formations instead of more of them.
  let alive = 0;
  for (let f = 0; f < st.F.n; f++) if (st.F.alive[f] && st.F.member[f] === mi) alive++;
  const room = MAX_FORMATIONS_PER_MEMBER - alive;
  const join = room <= 0 ? nearestCrewed(ctx, mi) : -1;
  if (join >= 0) {
    const F = st.F, o = join * NR;
    for (let r = 0; r < NR; r++) if (IS_LAND[r]) F.counts[o + r] += d[r] * share;
    refreshFormation(ctx, join);
    for (let r = 0; r < NR; r++) if (IS_LAND[r]) d[r] -= d[r] * share;
    return;
  }
  const nF = Math.max(1, Math.min(Math.floor(ship / mr.formationSize), room));
  const counts = new Float64Array(NR);
  for (let k = 0; k < nF; k++) {
    for (let r = 0; r < NR; r++) counts[r] = IS_LAND[r] ? (d[r] * share) / nF : 0;
    spawnFormation(ctx, mi, cell, counts, true, st.day);
  }
  for (let r = 0; r < NR; r++) if (IS_LAND[r]) d[r] -= d[r] * share;
}

export function productionPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const day = st.day;
  // 1. scheduled arrivals of committed formations (marching in or by sea)
  const arrivedBy = new Map<number, number>();
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || F.onMap[f] || F.arriveDay[f] > day) continue;
    const mi = F.member[f];
    const mr = S.members[mi];
    if (mr.entryBySea && blockaded(ctx, mr.side)) continue;
    let cell = F.spawnCell[f];
    if (cell < 0 || st.control[cell] === 1 - mr.side || sc.occ[1 - mr.side][cell] > 0) cell = spawnCellFor(ctx, mi);
    if (cell < 0) continue;
    F.cell[f] = cell;
    F.onMap[f] = 1;
    F.status[f] = UnitStatus.Idle;
    sc.occ[mr.side][cell]++;
    arrivedBy.set(mi, (arrivedBy.get(mi) ?? 0) + F.personnel[f]);
  }
  for (const [mi, p] of arrivedBy) {
    const mr = S.members[mi];
    addEvent(ctx, mr.side, 'arrival', `${Math.round(p).toLocaleString('en-US')} ${mr.name} troops arrived in the theater${mr.entryBySea ? ' by sea' : ''}.`, undefined, mr.entryCell);
  }
  // 2. backtest reinforcements
  const reinf = S.opts.reinforcements;
  if (reinf) {
    for (const side of [0, 1] as const) {
      for (const r of reinf[side] ?? []) {
        if (Math.ceil(r.day) !== day) continue;
        const mi = S.lead[side];
        const counts = new Float64Array(NR);
        let p = 0;
        for (const [role, v] of Object.entries(r.counts)) {
          const ri = RI[role as keyof typeof RI];
          if (ri == null || !(v! > 0) || !IS_LAND[ri]) continue;
          counts[ri] = v!;
          if (IS_P[ri]) p += v!;
        }
        const cell = spawnCellFor(ctx, mi);
        if (cell < 0) continue;
        const nf = spawnFormation(ctx, mi, cell, counts, true, day);
        const frac = r.day - Math.floor(r.day);
        if (SUBDAY_REINFORCEMENTS && frac > 0) { F.joinDay[nf] = day; F.joinRound[nf] = Math.min(S.H - 1, Math.ceil(frac * S.H)); }
        st.arrivals[side] += p;
        st.members[mi].fielded += p;
        addEvent(ctx, side, 'arrival', `${S.sideNames[side]} reinforcements arrived (${Math.round(p).toLocaleString('en-US')} troops).`, undefined, cell);
      }
    }
  }
  if (S.opts.noProduction || S.battleMode) return;
  // 3. members: reserves, recruits, returns, platforms
  const slot = day % RETURN_RING_DAYS;
  for (const mr of S.members) {
    const ms = st.members[mr.idx];
    if (mr.commitment <= 0) continue;
    if (ms.reservesDue > 0 && day >= ms.reservesDay) {
      addPersonnelToDepot(ctx, mr.idx, ms.reservesDue);
      addEvent(ctx, mr.side, 'mobilization', `${mr.name} mobilized ${Math.round(ms.reservesDue).toLocaleString('en-US')} reservists.`, `Mobilization takes ${Math.round(mr.mobilizationDays)} days at this communications tech.`);
      ms.reservesDue = 0;
    }
    if (day % RECRUIT_BATCH_DAYS === 0 && ms.mobilizableLeft > 0) {
      const batch = Math.min(ms.mobilizableLeft, mr.recruitsPerBatchDay * RECRUIT_BATCH_DAYS * mr.commitment);
      if (batch > 0) {
        ms.mobilizableLeft -= batch;
        ms.recruitQueue.push(day + Math.ceil(mr.trainingDays + mr.oneWayDays), batch);
      }
    }
    for (let i = 0; i < ms.recruitQueue.length; i += 2) {
      if (ms.recruitQueue[i] <= day) {
        addPersonnelToDepot(ctx, mr.idx, ms.recruitQueue[i + 1]);
        ms.recruitQueue.splice(i, 2);
        i -= 2;
      }
    }
    const ret = ms.returns[slot];
    if (ret > 0) {
      if (HOSPITAL_ADMISSIONS_RETURN) {
        // back from hospital: the same people, not new arrivals
        for (let r = 0; r < NR; r++) if (IS_P[r]) ms.depot[r] += ret * mr.pMix[r];
        st.hospital[mr.side] -= ret;
      } else addPersonnelToDepot(ctx, mr.idx, ret);
      st.returned[mr.side] += ret;
      ms.returns[slot] = 0;
    }
    if (day % 30 === 0) {
      const mult = (mr.seaDependent && blockaded(ctx, mr.side) ? S.m.production.blockadeProductionFactor.mid : 1) * ms.productionDamage;
      for (let r = 0; r < NR; r++) {
        const amt = mr.productionPerDay[r] * 30 * mr.commitment * mult;
        if (!(amt > 0) || IS_P[r]) continue;
        if (IS_NAVAL[r]) st.fleet[mr.side][r] += amt;
        else if (IS_AIR[r]) st.air[mr.side][r] += amt;
        else if (IS_LAND[r]) ms.depot[r] += amt;
      }
    }
    flushDepot(ctx, mr.idx, day % 30 === 0);
  }
}

export function depotPersonnel(ctx: Ctx, side: number): number {
  let p = 0;
  for (const mr of ctx.S.members) {
    if (mr.side !== side) continue;
    const d = ctx.st.members[mr.idx].depot;
    for (let r = 0; r < NR; r++) if (IS_P[r]) p += d[r];
  }
  return p;
}

export function depotPlatforms(ctx: Ctx, side: number): number {
  let p = 0;
  for (const mr of ctx.S.members) {
    if (mr.side !== side) continue;
    const d = ctx.st.members[mr.idx].depot;
    for (let r = 0; r < NR; r++) if (!IS_P[r]) p += d[r];
  }
  return p;
}
