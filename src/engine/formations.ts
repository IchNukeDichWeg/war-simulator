// Formation bookkeeping: power weight, loss booking by cause, destruction, spawning.
// Every personnel loss goes through here so conservation holds by construction.
import type { Ctx } from './ctx';
import { ensureScratchCap } from './ctx';
import { IS_P, NR } from './roles';
import { CREWED_FORMATIONS } from './constants';
import { growFormations, Mode } from './state';
import { UnitStatus } from './protocol';

/** Recompute personnel and power weight (sum count x own TLI) of formation f. */
export function refreshFormation(ctx: Ctx, f: number): void {
  const F = ctx.st.F;
  const mr = ctx.S.members[F.member[f]];
  const o = f * NR;
  let p = 0, w = 0;
  for (let r = 0; r < NR; r++) {
    const c = F.counts[o + r];
    if (c <= 0) continue;
    if (IS_P[r]) p += c;
    w += c * mr.tli[r];
  }
  F.personnel[f] = p;
  F.curW[f] = w;
}

export function platformsOf(ctx: Ctx, f: number): number {
  const F = ctx.st.F;
  const o = f * NR;
  let n = 0;
  for (let r = 0; r < NR; r++) if (!IS_P[r]) n += F.counts[o + r];
  return n;
}

function destroyIfEmpty(ctx: Ctx, f: number, cause: number): void {
  const F = ctx.st.F;
  if (!F.alive[f]) return;
  const o = f * NR;
  let p = 0, n = 0;
  for (let r = 0; r < NR; r++) { if (IS_P[r]) p += F.counts[o + r]; else n += F.counts[o + r]; }
  // a formation with no personnel left is gone: its platforms have no crews or escort (crews are
  // support personnel, not modelled per formation) and are booked as platform losses
  if (p >= 0.5 || (n >= 0.5 && !CREWED_FORMATIONS)) return;
  const side = F.side[f];
  ctx.st.losses[side][cause] += p;
  ctx.st.platformLosses[side] += n;
  for (let r = 0; r < NR; r++) F.counts[o + r] = 0;
  F.personnel[f] = 0;
  F.curW[f] = 0;
  F.alive[f] = 0;
  F.status[f] = UnitStatus.Destroyed;
  if (F.onMap[f]) ctx.sc.occ[side][F.cell[f]]--;
}

/** Remove a fraction of every role in formation f (or only personnel roles). Returns personnel lost. */
export function lossFraction(ctx: Ctx, f: number, frac: number, cause: number, pOnly = false): number {
  const F = ctx.st.F;
  if (!F.alive[f] || frac <= 0) return 0;
  const k = Math.min(1, frac);
  const o = f * NR;
  let lp = 0, ln = 0;
  for (let r = 0; r < NR; r++) {
    const c = F.counts[o + r];
    if (c <= 0) continue;
    if (pOnly && !IS_P[r]) continue;
    const l = c * k;
    F.counts[o + r] = c - l;
    if (IS_P[r]) lp += l; else ln += l;
  }
  const side = F.side[f];
  ctx.st.losses[side][cause] += lp;
  ctx.st.platformLosses[side] += ln;
  refreshFormation(ctx, f);
  destroyIfEmpty(ctx, f, cause);
  return lp;
}

/** Take `amount` personnel out of f without booking a loss (hospital admissions). Returns the number
 *  removed; a remnant below half a man is booked under `cause` as the formation dissolves. */
export function withdrawPersonnel(ctx: Ctx, f: number, amount: number, cause: number): number {
  const F = ctx.st.F;
  const p = F.personnel[f];
  if (!F.alive[f] || amount <= 0 || p <= 0) return 0;
  const k = Math.min(1, amount / p);
  const o = f * NR;
  let out = 0;
  for (let r = 0; r < NR; r++) {
    if (!IS_P[r]) continue;
    const c = F.counts[o + r];
    if (c <= 0) continue;
    F.counts[o + r] = c - c * k;
    out += c * k;
  }
  refreshFormation(ctx, f);
  destroyIfEmpty(ctx, f, cause);
  return out;
}

/** Remove `amount` personnel spread over the P roles in proportion to their counts. */
export function lossPersonnel(ctx: Ctx, f: number, amount: number, cause: number): number {
  const F = ctx.st.F;
  const p = F.personnel[f];
  if (!F.alive[f] || amount <= 0 || p <= 0) return 0;
  return lossFraction(ctx, f, Math.min(1, amount / p), cause, true);
}

/** Add a new formation (reinforcements, recruits, arrivals). Counts are copied. */
export function spawnFormation(ctx: Ctx, member: number, cell: number, counts: ArrayLike<number>, onMap: boolean, arriveDay: number): number {
  const { st, S } = ctx;
  const F = st.F;
  growFormations(F, F.n + 1);
  ensureScratchCap(ctx.sc, F.cap);
  const f = F.n++;
  const mr = S.members[member];
  F.member[f] = member;
  F.side[f] = mr.side;
  F.alive[f] = 1;
  F.cell[f] = cell;
  F.spawnCell[f] = cell;
  F.next[f] = -1;
  F.prog[f] = 0;
  F.edge[f] = 0;
  const o = f * NR;
  for (let r = 0; r < NR; r++) F.counts[o + r] = counts[r] ?? 0;
  refreshFormation(ctx, f);
  F.startW[f] = F.curW[f];
  F.startPersonnel[f] = F.personnel[f];
  F.morale[f] = mr.morale0;
  F.supply[f] = 1;
  F.stock[f] = mr.carriedDays;
  F.engLoss[f] = 0;
  F.engagedDays[f] = 0;
  F.noSupplyDays[f] = 0;
  F.status[f] = onMap ? UnitStatus.Idle : UnitStatus.Embarked;
  F.mode[f] = Mode.Hold;
  F.obj[f] = -1;
  F.pendObj[f] = -1;
  F.pendMode[f] = Mode.Hold;
  F.pendDay[f] = -1;
  F.heading[f] = NaN;
  F.movedKm[f] = 0;
  F.fought[f] = 0;
  F.moved[f] = 0;
  F.stillDays[f] = 1;
  F.arriveDay[f] = arriveDay;
  F.onMap[f] = onMap ? 1 : 0;
  F.feignUsed[f] = 0;
  F.routDays[f] = 0;
  F.battle[f] = -1;
  F.joinDay[f] = -1;
  F.joinRound[f] = 0;
  if (onMap) ctx.sc.occ[mr.side][cell]++;
  st.addedW[mr.side] += F.curW[f];
  return f;
}
