// Command AI (ENGINE.md section 10). One planning cycle per side every
// AI_CYCLE_DAYS x coalition friction; each member commander scores the shared
// candidate objectives with its own doctrine and orders its own formations,
// which receive the orders after its order delay.
import type { Ctx } from './ctx';
import { byTech } from './mech';
import { dijkstra, haversineKm } from './grid';
import { Mode } from './state';
import { computeField, computeInvSpeed } from './movement';
import {
  AI_CYCLE_DAYS, AI_MASS_RATIO_ATTRITION, AI_MASS_RATIO_MANEUVER, AI_MAX_OBJECTIVES, AI_RECOVERED_STRENGTH,
  AI_SECTORS_PER_AXIS, AI_VALUE_CAPITAL, AI_VALUE_CITY, AI_VALUE_DEFENSE, AI_VALUE_FORMATION, AIR_MIN_TECH,
  AI_DEFEND_CAP_BY_VALUE, HOLD_SIDE_NO_PLACE_TARGETS, LEFTOVERS_FOLLOW_OBJECTIVE, OUT_OF_SUPPLY_FALLBACK_DAYS, UNSEEN_RANGE_FACTOR, RESERVE_NO_OVERSHOOT,
  AI_CROSS_ERA_POWER, AI_STRONGER_SIDE_ADVANCES } from './constants';
import { NR } from './roles';

export const OBJ = { Capital: 0, City: 1, Formation: 2, Defend: 3, Case: 4 } as const;

interface Cand { cell: number; kind: number; base: number; pow: number }

function applyPending(ctx: Ctx): void {
  const F = ctx.st.F;
  const day = ctx.st.day;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || F.pendDay[f] < 0 || F.pendDay[f] > day) continue;
    if (F.mode[f] === Mode.Rout) continue;
    if (F.obj[f] !== F.pendObj[f] || F.mode[f] !== F.pendMode[f]) { F.next[f] = -1; F.prog[f] = 0; }
    F.obj[f] = F.pendObj[f];
    F.mode[f] = F.pendMode[f];
    F.pendDay[f] = -1;
  }
}

function order(ctx: Ctx, f: number, mode: number, cell: number, delay: number): void {
  const F = ctx.st.F;
  F.pendObj[f] = cell;
  F.pendMode[f] = mode;
  F.pendDay[f] = ctx.st.day + delay;
}

/** Battle mode: attackers go for the nearest enemy, defenders hold. Orders are immediate. */
function battleOrders(ctx: Ctx, side: 0 | 1): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const enemy = 1 - side;
  const posture = S.opts.postures?.[side] ?? (side === 0 ? 'attack' : 'defend');
  let target = S.objectiveCells[side];
  if (target < 0) {
    for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === enemy) { target = F.cell[f]; break; }
  }
  st.objCells[side].fill(-1);
  if (target < 0) return;
  computeInvSpeed(ctx, side);
  st.objCells[side][0] = target;
  st.objKind[side][0] = OBJ.Case;
  computeField(ctx, side, 0, target);
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.side[f] !== side || F.mode[f] === Mode.Rout || F.mode[f] === Mode.Retreat) continue;
    order(ctx, f, posture === 'attack' ? Mode.Attack : Mode.Hold, posture === 'attack' ? target : -1, 0);
  }
  void sc;
}

export function aiPhase(ctx: Ctx): void {
  const { S, st } = ctx;
  for (const side of [0, 1] as const) {
    if (st.day < st.nextPlanDay[side]) continue;
    if (S.battleMode) { battleOrders(ctx, side); st.nextPlanDay[side] = st.day + 1; continue; }
    planSide(ctx, side);
    st.nextPlanDay[side] = st.day + Math.max(1, Math.round(AI_CYCLE_DAYS * S.friction[side]));
  }
  applyPending(ctx);
}

function planSide(ctx: Ctx, side: 0 | 1): void {
  const { S, st, sc, rng } = ctx;
  const F = st.F;
  const g = S.grid;
  const n = g.n;
  const enemy = (1 - side) as 0 | 1;
  const lead = S.members[S.lead[side]];
  // ---- 1. perceive the enemy
  const seen = sc.enemySeen[side];
  seen.fill(0);
  let radius = Infinity;
  if (S.scenario.rules.fogOfWar) {
    let fastest = 0;
    for (const mi of S.sideMembers[side]) {
      const mr = S.members[mi];
      for (let r = 0; r < NR; r++) if (mr.rate[r] > fastest && (mr.snap.military.forces as any)[Object.keys(mr.snap.military.forces)[0]] !== undefined) fastest = Math.max(fastest, mr.rate[r]);
    }
    radius = lead.w.scouting * fastest * AI_CYCLE_DAYS;
    const pt = S.poolTech[side];
    let air = 0;
    for (let r = 0; r < NR; r++) air += st.air[side][r];
    if (pt.air >= AIR_MIN_TECH && air > 0) radius = Math.max(radius, byTech(S.m.air.combatRadiusKm, pt.air));
    if (lead.tech.isr >= 8) radius = Infinity;
  }
  let distOwn: Float32Array | null = null;
  if (radius < Infinity) {
    const inv = sc.tmpN;
    for (let c = 0; c < n; c++) inv[c] = 1;
    const srcs: number[] = [];
    for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === side) srcs.push(F.cell[f]);
    distOwn = new Float32Array(n);
    dijkstra(g, sc.heap, inv, null, srcs, null, distOwn, null);
  }
  let totalEnemy = 0;
  // enemy strength in own-strength units: what it does to us vs what we do to it
  const xk = AI_CROSS_ERA_POWER ? S.members[S.lead[enemy]].dispersion / Math.max(1e-12, lead.dispersion) : 1;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.side[f] !== enemy) continue;
    const c = F.cell[f];
    let k = xk;
    if (distOwn) {
      const d = distOwn[c];
      if (d > radius * UNSEEN_RANGE_FACTOR) continue;
      if (d > radius) k *= 1 + S.rules.fogError * (2 * rng.next() - 1);
    }
    seen[c] += F.curW[f] * k;
    totalEnemy += F.curW[f] * k;
  }
  // ---- 2. sectors
  const sx = Math.max(1, Math.ceil(g.cols / AI_SECTORS_PER_AXIS)), sy = Math.max(1, Math.ceil(g.rows / AI_SECTORS_PER_AXIS));
  const nsx = Math.ceil(g.cols / sx), nsy = Math.ceil(g.rows / sy);
  const nsec = nsx * nsy;
  const secPow = sc.sectorPow, secCell = sc.sectorCell, secBest = sc.sectorBest;
  secPow.fill(0, 0, nsec); secBest.fill(0, 0, nsec); secCell.fill(-1, 0, nsec);
  const secOf = (c: number) => Math.floor(Math.floor(c / g.cols) / sy) * nsx + Math.floor((c % g.cols) / sx);
  for (let c = 0; c < n; c++) {
    if (seen[c] <= 0) continue;
    const s = secOf(c);
    secPow[s] += seen[c];
    if (seen[c] > secBest[s]) { secBest[s] = seen[c]; secCell[s] = c; }
  }
  const near = (c: number) => {
    const s = secOf(c);
    const R = Math.floor(s / nsx), C = s % nsx;
    let p = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = R + dr, cc = C + dc;
      if (rr >= 0 && rr < nsy && cc >= 0 && cc < nsx) p += secPow[rr * nsx + cc];
    }
    return p;
  };
  // ---- 3. candidates
  const cands: Cand[] = [];
  let ownTotal = 0;
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === side) ownTotal += F.curW[f];
  if (S.objectiveCells[side] >= 0) cands.push({ cell: S.objectiveCells[side], kind: OBJ.Case, base: 10 * AI_VALUE_CAPITAL, pow: near(S.objectiveCells[side]) });
  // a side whose case objective is to hold a place defends it and fights enemy formations, but
  // does not march on enemy places (Iraq 2003 sent 14 of 22 formations at the Coalition's base)
  const holdTargets = HOLD_SIDE_NO_PLACE_TARGETS && S.objectiveKinds[side] === 'hold';
  let popMax = 1;
  for (const p of S.places) popMax = Math.max(popMax, p.pop);
  for (const p of S.places) {
    const ctl = st.control[p.cell];
    if (ctl === enemy) {
      if (holdTargets) continue;
      cands.push({ cell: p.cell, kind: p.capital ? OBJ.Capital : OBJ.City, base: p.capital ? AI_VALUE_CAPITAL : AI_VALUE_CITY * (1 + p.pop / popMax), pow: near(p.cell) });
    } else if (ctl === side) {
      const threat = near(p.cell);
      if (threat > 0) cands.push({ cell: p.cell, kind: OBJ.Defend, base: AI_VALUE_DEFENSE * (p.capital ? 2 : 1) * Math.min(2, threat / Math.max(1e-9, ownTotal)), pow: threat });
    }
  }
  let maxSec = 0;
  for (let s = 0; s < nsec; s++) maxSec = Math.max(maxSec, secPow[s]);
  for (let s = 0; s < nsec; s++) {
    if (secPow[s] <= 0 || secCell[s] < 0) continue;
    cands.push({ cell: secCell[s], kind: OBJ.Formation, base: AI_VALUE_FORMATION * Math.sqrt(secPow[s] / Math.max(1e-9, totalEnemy)), pow: near(secCell[s]) });
  }
  // dedupe by cell (keep the highest base)
  const byCell = new Map<number, Cand>();
  for (const c of cands) { const o = byCell.get(c.cell); if (!o || c.base > o.base) byCell.set(c.cell, c); }
  const uniq = [...byCell.values()].sort((a, b) => a.cell - b.cell);
  // ---- 4. score per member, pick top K cells
  const centroid = new Map<number, [number, number]>();
  for (const mi of S.sideMembers[side]) {
    let la = 0, lo = 0, k = 0;
    for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.member[f] === mi) { la += g.lat[F.cell[f]]; lo += g.lon[F.cell[f]]; k++; }
    const mr = S.members[mi];
    if (k) centroid.set(mi, [la / k, lo / k]);
    else if (mr.spawnCells.length) centroid.set(mi, [g.lat[mr.spawnCells[0]], g.lon[mr.spawnCells[0]]]);
  }
  // value of an objective to a member (doctrine-weighted, before distance)
  const value = (mi: number, c: Cand): number => {
    const mr = S.members[mi];
    const w = mr.w;
    const ce = centroid.get(mi);
    const dist = ce ? haversineKm(ce[0], ce[1], g.lat[c.cell], g.lon[c.cell]) : 0;
    const range = Math.max(1, mr.supplyRangeKm);
    let v: number;
    if (c.kind === OBJ.Case) v = c.base;
    else if (c.kind === OBJ.Defend) v = c.base * (1.5 - w.aggression);
    else {
      v = c.base * (0.5 + w.aggression);
      if (c.kind === OBJ.Formation) v *= (1.5 - w.siegePreference) * (1 + w.maneuver * (1 - c.pow / Math.max(1e-9, maxSec)));
      else v *= 0.5 + w.siegePreference;
      if (dist > range) v *= 1 - w.logisticsDiscipline;
    }
    return v;
  };
  const score = (mi: number, c: Cand): number => {
    const mr = S.members[mi];
    const ce = centroid.get(mi);
    const dist = ce ? haversineKm(ce[0], ce[1], g.lat[c.cell], g.lon[c.cell]) : 0;
    return value(mi, c) / (1 + dist / Math.max(1, mr.supplyRangeKm));
  };
  const best = uniq.map((c) => ({ c, s: Math.max(...S.sideMembers[side].map((mi) => score(mi, c))) }));
  best.sort((a, b) => b.s - a.s || a.c.cell - b.c.cell);
  const chosen = best.slice(0, AI_MAX_OBJECTIVES).map((x) => x.c);
  // ---- 5. fields
  computeInvSpeed(ctx, side);
  st.objCells[side].fill(-1);
  chosen.forEach((c, k) => {
    st.objCells[side][k] = c.cell;
    st.objKind[side][k] = c.kind;
    computeField(ctx, side, k, c.cell);
  });
  // ---- 6. assignment per member
  for (const mi of S.sideMembers[side]) {
    const mr = S.members[mi];
    const w = mr.w;
    const delay = Math.max(0, Math.round(mr.orderDelay * S.friction[side]));
    const avail: number[] = [];
    let totalW = 0;
    for (let f = 0; f < F.n; f++) {
      if (!F.alive[f] || !F.onMap[f] || F.member[f] !== mi) continue;
      if (F.mode[f] === Mode.Rout) continue;
      // fall back only when it helps: out of supply AND beyond supply range of a reachable depot
      // (at a congested depot, or cut off entirely, moving back does not feed anyone)
      const sd = st.supplyDist[side][F.cell[f]];
      if (F.noSupplyDays[f] > OUT_OF_SUPPLY_FALLBACK_DAYS && sd > mr.supplyRangeKm && sd < Infinity) {
        order(ctx, f, Mode.Retreat, -1, delay);
        continue;
      }
      if (F.mode[f] === Mode.Retreat && F.morale[f] < AI_RECOVERED_STRENGTH * mr.morale0) continue;
      avail.push(f);
      totalW += F.curW[f];
    }
    if (!avail.length) continue;
    const slots = chosen.map((c, k) => ({ c, k, s: score(mi, c) })).sort((a, b) => b.s - a.s || a.k - b.k);
    const taken = new Uint8Array(avail.length);
    // reserve at the most threatened own place (or hold in place)
    const defendSlot = slots.find((x) => x.c.kind === OBJ.Defend);
    const reserveW = w.reserveUse * totalW;
    if (reserveW > 0 && !(RESERVE_NO_OVERSHOOT && avail.length < 2)) {
      const anchor = defendSlot ? defendSlot.c.cell : (mr.capitalCell >= 0 ? mr.capitalCell : mr.spawnCells[0] ?? -1);
      const idx = avail.map((f, i) => i);
      if (anchor >= 0) idx.sort((a, b) => haversineKm(g.lat[F.cell[avail[a]]], g.lon[F.cell[avail[a]]], g.lat[anchor], g.lon[anchor]) - haversineKm(g.lat[F.cell[avail[b]]], g.lon[F.cell[avail[b]]], g.lat[anchor], g.lon[anchor]) || a - b);
      let acc = 0;
      for (const i of idx) {
        if (acc >= reserveW) break;
        if (RESERVE_NO_OVERSHOOT && acc + F.curW[avail[i]] > reserveW) continue;
        taken[i] = 1;
        acc += F.curW[avail[i]];
        order(ctx, avail[i], defendSlot ? Mode.Defend : Mode.Hold, defendSlot ? defendSlot.c.cell : -1, delay);
      }
    }
    const ratio = AI_MASS_RATIO_ATTRITION + (AI_MASS_RATIO_MANEUVER - AI_MASS_RATIO_ATTRITION) * w.maneuver;
    // a Defend slot absorbs at most its value's share of the member's army (QA C4: Defend slots near
    // the start won on distance and their need, the enemy power nearby, took the whole army)
    const valSum = slots.reduce((a, x) => a + (x.s > 0 ? value(mi, x.c) : 0), 0);
    for (const sl of slots) {
      if (sl.s <= 0) continue;
      const field = st.fields[side].subarray(sl.k * n, (sl.k + 1) * n);
      const idx: number[] = [];
      for (let i = 0; i < avail.length; i++) if (!taken[i] && field[F.cell[avail[i]]] < Infinity) idx.push(i);
      if (!idx.length) continue;
      idx.sort((a, b) => field[F.cell[avail[a]]] - field[F.cell[avail[b]]] || a - b);
      const defend = sl.c.kind === OBJ.Defend || (holdTargets && sl.c.kind === OBJ.Case);
      let need = sl.c.pow * (defend ? 1 : ratio);
      const capped = AI_DEFEND_CAP_BY_VALUE && sl.c.kind === OBJ.Defend && valSum > 0;
      if (capped) need = Math.min(need, totalW * value(mi, sl.c) / valSum);
      let acc = 0;
      const mode = defend ? Mode.Defend : Mode.Attack;
      for (const i of idx) {
        if (capped && acc + F.curW[avail[i]] > need) continue;   // the cap is a ceiling, not a floor
        taken[i] = 1;
        acc += F.curW[avail[i]];
        order(ctx, avail[i], mode, sl.c.cell, delay);
        if (acc >= need) break;
      }
    }
    // leftovers: aggressive commanders join the nearest attack, others hold; a side whose case
    // objective is to hold a place defends it instead (Iraq 2003: 9-15 of 22 Iraqi formations
    // attacked as leftovers of an aggression-0.5 doctrine)
    const holdSide = LEFTOVERS_FOLLOW_OBJECTIVE && S.objectiveKinds[side] === 'hold';
    const holdSlot = holdSide ? slots.find((x) => x.c.cell === S.objectiveCells[side]) ?? defendSlot : undefined;
    for (let i = 0; i < avail.length; i++) {
      if (taken[i]) continue;
      const f = avail[i];
      let bestK = -1, bv = Infinity;
      if (holdSide) {
        order(ctx, f, holdSlot ? Mode.Defend : Mode.Hold, holdSlot ? holdSlot.c.cell : -1, delay);
        continue;
      }
      if (w.aggression >= 0.5 || (AI_STRONGER_SIDE_ADVANCES && ownTotal > totalEnemy)) {
        for (const sl of slots) {
          if (sl.c.kind === OBJ.Defend) continue;
          const v = st.fields[side][sl.k * n + F.cell[f]];
          if (v < bv) { bv = v; bestK = sl.k; }
        }
      }
      if (bestK >= 0) order(ctx, f, Mode.Attack, st.objCells[side][bestK], delay);
      else order(ctx, f, defendSlot ? Mode.Defend : Mode.Hold, defendSlot ? defendSlot.c.cell : -1, delay);
    }
  }
}
