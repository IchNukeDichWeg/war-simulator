// Frame building (protocol.ts). Positions interpolate along the edge a moving
// formation is crossing.
import type { Ctx } from './ctx';
import { seasonName } from './ctx';
import type { Frame, SideStats } from './protocol';
import { UNIT_STRIDE, U, UnitStatus, type LossCause } from './protocol';
import { LOSS_CAUSES, NR, IS_P, AIR_ROLES, NAVAL_ROLES } from './roles';
import { CONTROL_FRAME_DAYS, MAX_SUPPLY_LINES } from './constants';
import { depotPersonnel, depotPlatforms } from './production';

export function sideStats(ctx: Ctx, side: 0 | 1): SideStats {
  const { S, st } = ctx;
  const F = st.F;
  let personnel = 0, platforms = 0, supW = 0, sup = 0, mor = 0, morW = 0;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || F.side[f] !== side) continue;
    personnel += F.personnel[f];
    const o = f * NR;
    for (let r = 0; r < NR; r++) if (!IS_P[r]) platforms += F.counts[o + r];
    if (!F.onMap[f]) continue;
    const w = Math.max(F.curW[f], 1e-9);
    sup += F.supply[f] * w; supW += w;
    mor += F.morale[f] * w; morW += w;
  }
  personnel += depotPersonnel(ctx, side);
  platforms += depotPlatforms(ctx, side);
  for (const r of AIR_ROLES) platforms += st.air[side][r];
  for (const r of NAVAL_ROLES) platforms += st.fleet[side][r];
  const lossesByCause = {} as Record<LossCause, number>;
  let casualties = 0;
  // casualties = killed + wounded + captured (battle, pursuit, air, naval, nuclear); disease,
  // exposure, starvation and desertion are in lossesByCause only
  LOSS_CAUSES.forEach((c, i) => {
    lossesByCause[c] = st.losses[side][i];
    if (c === 'combat' || c === 'pursuit' || c === 'captured' || c === 'air' || c === 'naval' || c === 'nuclear') casualties += st.losses[side][i];
  });
  let held = 0;
  for (let c = 0; c < S.grid.n; c++) if (st.control[c] === side) held++;
  return {
    personnel, platforms, casualties, lossesByCause,
    supply: supW > 0 ? sup / supW : 0,
    morale: morW > 0 ? mor / morW : 0,
    territory: S.grid.landCount ? held / S.grid.landCount : 0,
    seaControl: st.seaControl[side],
    airSuperiority: st.airSup[side],
  };
}

function supplyLines(ctx: Ctx, side: 0 | 1): number[][] {
  const { S, st } = ctx;
  const F = st.F;
  const g = S.grid;
  const dist = st.supplyDist[side];
  const cand: number[] = [];
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === side && dist[F.cell[f]] < Infinity && dist[F.cell[f]] > 0) cand.push(f);
  cand.sort((a, b) => F.curW[b] - F.curW[a] || a - b);
  const seenCells = new Set<number>();
  const lines: number[][] = [];
  for (const f of cand) {
    if (lines.length >= MAX_SUPPLY_LINES) break;
    let c = F.cell[f];
    if (seenCells.has(c)) continue;
    seenCells.add(c);
    const line: number[] = [+g.lon[c].toFixed(3), +g.lat[c].toFixed(3)];
    for (let steps = 0; steps < 400 && dist[c] > 0; steps++) {
      let best = -1, bv = dist[c];
      for (let d = 0; d < 8; d++) { const j = g.nb[c * 8 + d]; if (j >= 0 && dist[j] < bv) { bv = dist[j]; best = j; } }
      if (best < 0) break;
      c = best;
      line.push(+g.lon[c].toFixed(3), +g.lat[c].toFixed(3));
    }
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

export interface FrameCursor { eventIdx: number; controlVersion: number; controlDay: number }

export function buildFrame(ctx: Ctx, cur: FrameCursor, forceControl = false): Frame {
  const { S, st } = ctx;
  const F = st.F;
  const g = S.grid;
  let n = 0;
  for (let f = 0; f < F.n; f++) if (F.onMap[f] && F.alive[f]) n++;
  const units = new Float32Array(n * UNIT_STRIDE);
  let k = 0;
  for (let f = 0; f < F.n; f++) {
    if (!F.onMap[f] || !F.alive[f]) continue;
    const mr = S.members[F.member[f]];
    const c = F.cell[f];
    let lon = g.lon[c], lat = g.lat[c];
    const nx = F.next[f];
    if (nx >= 0 && F.prog[f] > 0 && F.edge[f] > 0 && isFinite(F.edge[f])) {
      const t = Math.min(1, F.prog[f] / F.edge[f]);
      lon += (g.lon[nx] - lon) * t;
      lat += (g.lat[nx] - lat) * t;
    }
    let dom = 0, dv = -1;
    const o = f * NR;
    for (let r = 0; r < NR; r++) { const v = F.counts[o + r] * Math.max(mr.tli[r], 1e-9); if (v > dv) { dv = v; dom = r; } }
    const b = k * UNIT_STRIDE;
    units[b + U.lon] = lon;
    units[b + U.lat] = lat;
    units[b + U.side] = F.side[f];
    units[b + U.role] = dom;
    units[b + U.strength] = F.startW[f] > 0 ? Math.min(1, F.curW[f] / F.startW[f]) : 1;
    units[b + U.heading] = F.heading[f];
    units[b + U.supply] = F.supply[f];
    units[b + U.morale] = F.morale[f];
    units[b + U.status] = F.status[f];
    units[b + U.id] = f;
    units[b + U.personnel] = F.personnel[f];
    units[b + U.techEra] = mr.tech.weapons;
    k++;
  }
  const frame: Frame = {
    day: st.day,
    date: `Day ${st.day}, ${seasonName(ctx)}`,
    units,
    stats: [sideStats(ctx, 0), sideStats(ctx, 1)],
    battles: st.battlesToday.slice(),
    events: st.events.slice(cur.eventIdx),
  };
  cur.eventIdx = st.events.length;
  if (forceControl || st.controlVersion !== cur.controlVersion || st.day - cur.controlDay >= CONTROL_FRAME_DAYS) {
    frame.control = st.control.slice();
    frame.supplyLines = [supplyLines(ctx, 0), supplyLines(ctx, 1)];
    cur.controlVersion = st.controlVersion;
    cur.controlDay = st.day;
  }
  return frame;
}
