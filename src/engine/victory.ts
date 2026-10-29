// Territorial control and victory conditions (ENGINE.md section 12).
import type { Ctx } from './ctx';
import { addEvent } from './ctx';
import { Mode } from './state';
import { isProtectedEnemyPlace, enterCell } from './movement';
import { depotPersonnel } from './production';
import {
  BATTLE_MODE_NO_CONTACT_DAYS, ENCIRCLED_FLIP_NEEDS_SUPPLY, OBJECTIVE_KIND_EXPLICIT, STALEMATE_DAYS, TIME_LIMIT_TERRITORY_MARGIN,
} from './constants';

/**
 * Control rules: a cell occupied by one side only becomes that side's; an empty
 * cell next to formations of one side only follows them (zone of control);
 * enemy cells cut off from every enemy supply source and touching own ground
 * fall one ring per day (pockets surrender). Unreduced enemy fortresses only
 * fall to siege.
 */
export function controlPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const [c0, c1] = sc.claim;
  c0.fill(0); c1.fill(0);
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.mode[f] === Mode.Rout) continue;
    const cl = F.side[f] === 0 ? c0 : c1;
    const c = F.cell[f];
    cl[c] = 2;
    for (let d = 0; d < 8; d++) { const j = g.nb[c * 8 + d]; if (j >= 0 && cl[j] === 0) cl[j] = 1; }
  }
  sc.prevControl.set(st.control);
  const prev = sc.prevControl;
  for (let c = 0; c < g.n; c++) {
    if (!g.land[c]) continue;
    const o0 = sc.occ[0][c] > 0, o1 = sc.occ[1][c] > 0;
    let to = -1;
    if (o0 !== o1) to = o0 ? 0 : 1;
    else if (!o0 && !o1) {
      if (c0[c] && !c1[c]) to = 0;
      else if (c1[c] && !c0[c]) to = 1;
      else {
        const t = prev[c];
        if (t === 0 || t === 1) {
          const s = 1 - t;
          if (st.supplyDist[t][c] === Infinity) {
            for (let d = 0; d < 8; d++) {
              const j = g.nb[c * 8 + d];
              if (j >= 0 && prev[j] === s && (!ENCIRCLED_FLIP_NEEDS_SUPPLY || st.supplyDist[s][j] !== Infinity)) { to = s; break; }
            }
          }
        }
      }
    }
    if (to < 0 || prev[c] === to) continue;
    if (isProtectedEnemyPlace(ctx, to, c) && !(to === 0 ? o0 : o1)) continue;
    enterCell(ctx, to as 0 | 1, c);
  }
  // capitals
  for (const mr of S.members) {
    if (mr.capitalCell < 0) continue;
    const ms = st.members[mr.idx];
    const held = st.control[mr.capitalCell] === 1 - mr.side && sc.occ[mr.side][mr.capitalCell] === 0;
    if (held) {
      ms.capitalHeldDays++;
      if (!ms.capitalLost) {
        ms.capitalLost = true;
        for (let f = 0; f < F.n; f++) if (F.alive[f] && F.member[f] === mr.idx) F.morale[f] = Math.max(0, F.morale[f] - S.m.morale.capitalLossShock.mid);
        addEvent(ctx, (1 - mr.side) as 0 | 1, 'capture', `${mr.name} lost its capital ${mr.snap.capital?.name ?? ''}.`, `Morale shock ${S.m.morale.capitalLossShock.mid} on all its formations.`, mr.capitalCell);
      }
    } else ms.capitalHeldDays = 0;
  }
}

export interface SideNow { personnel: number; w: number; morale: number; formations: number; pending: number }

export function sideNow(ctx: Ctx, side: number): SideNow {
  const F = ctx.st.F;
  let p = 0, w = 0, mw = 0, n = 0, pending = 0;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || F.side[f] !== side) continue;
    p += F.personnel[f];
    if (!F.onMap[f]) { pending++; continue; }
    w += F.curW[f];
    mw += F.morale[f] * F.curW[f];
    n++;
  }
  p += depotPersonnel(ctx, side);
  for (const mr of ctx.S.members) {
    if (mr.side !== side) continue;
    const ms = ctx.st.members[mr.idx];
    if (ms.reservesDue > 0 || ms.recruitQueue.length || ms.mobilizableLeft > 0 && mr.recruitsPerBatchDay > 0 && mr.commitment > 0) pending++;
  }
  return { personnel: p, w, morale: w > 0 ? mw / w : 0, formations: n, pending };
}

/** Share of `of`'s starting theater cells now held by `by`. */
export function heldShare(ctx: Ctx, by: number, of: number): number {
  const { S, st } = ctx;
  const tot = S.startCells[of];
  if (!tot) return 0;
  let k = 0;
  for (let c = 0; c < S.grid.n; c++) if (S.control0[c] === of && st.control[c] === by) k++;
  return k / tot;
}

function end(ctx: Ctx, winner: 0 | 1 | 'draw', reason: string, fraction = 1): void {
  const { S, st } = ctx;
  st.ended = true;
  st.winner = winner;
  st.endReason = reason;
  st.endFraction = fraction;
  addEvent(ctx, winner === 'draw' ? -1 : winner, 'end', winner === 'draw' ? `The war ended in a draw: ${reason}.` : `${S.sideNames[winner]} won: ${reason}.`);
}

export function victoryPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const V = S.scenario.victory;
  const now = [sideNow(ctx, 0), sideNow(ctx, 1)];
  if (S.battleMode) {
    const decided = sc.battles.filter((b) => b.winner >= 0);
    if (sc.battles.length) st.battleModeContact = true;
    if (decided.length) {
      // the largest decided battle settles it
      decided.sort((a, b) => b.parts[0].length + b.parts[1].length - a.parts[0].length - a.parts[1].length);
      const b = decided[0];
      end(ctx, b.winner as 0 | 1, `${S.sideNames[1 - b.winner]} broke`, b.endRound / S.H);
      return;
    }
    if (now[0].formations === 0 && now[1].formations === 0) { end(ctx, 'draw', 'both forces dissolved'); return; }
    for (const s of [0, 1] as const) if (now[1 - s].formations === 0 && now[1 - s].pending === 0) { end(ctx, s, `${S.sideNames[1 - s]} has no formations left`); return; }
    const sinceContact = st.day - st.lastActivityDay;
    if (!sc.battles.length && sinceContact >= BATTLE_MODE_NO_CONTACT_DAYS) {
      // no fight: the side that withdrew lost the field
      let routed: [number, number] = [0, 0];
      const F = st.F;
      for (let f = 0; f < F.n; f++) if (F.alive[f] && (F.mode[f] === 3 || F.mode[f] === 4)) routed[F.side[f]] += F.curW[f];
      if (routed[0] !== routed[1] && (routed[0] > 0 || routed[1] > 0)) end(ctx, routed[0] > routed[1] ? 1 : 0, 'the other side left the field');
      else end(ctx, 'draw', 'no contact');
      return;
    }
    if (st.day >= V.timeLimitDays) { end(ctx, 'draw', 'time limit'); }
    return;
  }
  const wins: [string | null, string | null] = [null, null];
  for (const s of [0, 1] as const) {
    const o = (1 - s) as 0 | 1;
    const no = now[o];
    if (V.armyCollapse) {
      const base = st.startPersonnel[o] + st.arrivals[o];
      const baseW = st.startW[o] + st.addedW[o];
      const collapsed = base > 0 ? no.personnel < S.rules.collapsePersonnel * base : baseW > 0 && no.w < S.rules.collapsePersonnel * baseW;
      if (collapsed && (base > 0 || baseW > 0)) wins[s] = `${S.sideNames[o]}'s army collapsed (personnel below ${Math.round(S.rules.collapsePersonnel * 100)}% of all it fielded)`;
      // morale collapse needs morale to have FALLEN below the threshold (some forces start low)
      else if (no.formations > 0 && no.morale < S.rules.collapseMorale && no.morale < st.startMorale[o]) wins[s] = `${S.sideNames[o]}'s morale collapsed (${no.morale.toFixed(2)})`;
    }
    if (!wins[s] && V.capitalCaptured) {
      const lead = S.members[S.lead[o]];
      if (lead.capitalCell >= 0 && st.members[lead.idx].capitalHeldDays >= 1) wins[s] = `captured ${lead.name}'s capital ${lead.snap.capital?.name ?? ''}`.trim();
    }
    if (!wins[s] && V.territoryShare > 0 && S.startCells[o] > 0) {
      const h = heldShare(ctx, s, o);
      if (h >= V.territoryShare) wins[s] = `holds ${Math.round(h * 100)}% of ${S.sideNames[o]}'s starting territory`;
    }
    // a capture objective (not held at start) wins when taken; a hold objective is judged at the end
    const oc = S.objectiveCells[s];
    const kind = OBJECTIVE_KIND_EXPLICIT ? S.objectiveKinds[s] : undefined;
    if (!wins[s] && oc >= 0 && kind === 'destroy') {
      const tg = st.destroyTargets[s];
      if (tg.length > 0 && tg.every((f) => !st.F.alive[f])) wins[s] = 'destroyed the enemy force at its objective';
    } else if (!wins[s] && oc >= 0 && sc.occ[o][oc] === 0 && st.control[oc] === s) {
      // capture counts only for a cell the enemy held at the start (QA round 2: own-territory
      // objectives were "taken" on day 1 with no battle)
      if (kind === 'capture' ? sc.occ[s][oc] > 0 && S.control0[oc] === o : kind === undefined && S.control0[oc] !== s) wins[s] = 'took its objective';
    }
  }
  if (wins[0] && wins[1]) { end(ctx, 'draw', `both sides met a victory condition (${wins[0]}; ${wins[1]})`); return; }
  for (const s of [0, 1] as const) if (wins[s]) { end(ctx, s, wins[s]!); return; }
  if (now[0].formations + now[0].pending === 0 && now[1].formations + now[1].pending === 0) {
    end(ctx, 'draw', 'neither side can field forces in the theater');
    return;
  }
  const timeUp = st.day >= V.timeLimitDays;
  // forces still marching or sailing in keep the war open
  if (now[0].pending > 0 || now[1].pending > 0) {
    const F = st.F;
    for (let f = 0; f < F.n; f++) if (F.alive[f] && !F.onMap[f]) { st.lastActivityDay = Math.max(st.lastActivityDay, Math.min(st.day, F.arriveDay[f])); }
  }
  const stale = st.day - st.lastActivityDay >= STALEMATE_DAYS;
  if (timeUp || stale) {
    const h0 = heldShare(ctx, 0, 1), h1 = heldShare(ctx, 1, 0);
    const s0 = now[0].w / Math.max(1e-9, st.startW[0] + st.addedW[0]);
    const s1 = now[1].w / Math.max(1e-9, st.startW[1] + st.addedW[1]);
    const why = timeUp ? `time limit of ${V.timeLimitDays} days` : `${STALEMATE_DAYS} days without battle or change of territory`;
    const isHold = (s: 0 | 1) => {
      const kind = OBJECTIVE_KIND_EXPLICIT ? S.objectiveKinds[s] : undefined;
      return kind ? kind === 'hold' : S.control0[S.objectiveCells[s]] === s;
    };
    const holds = ([0, 1] as const).filter((s) => S.objectiveCells[s] >= 0 && isHold(s) && st.control[S.objectiveCells[s]] === s);
    if (holds.length === 1) { end(ctx, holds[0], `${why}; still holds its objective`); return; }
    if (h0 >= h1 + TIME_LIMIT_TERRITORY_MARGIN && s0 >= s1) end(ctx, 0, `${why}; holds ${Math.round(h0 * 100)}% of the enemy's territory vs ${Math.round(h1 * 100)}%`);
    else if (h1 >= h0 + TIME_LIMIT_TERRITORY_MARGIN && s1 >= s0) end(ctx, 1, `${why}; holds ${Math.round(h1 * 100)}% of the enemy's territory vs ${Math.round(h0 * 100)}%`);
    else end(ctx, 'draw', why);
  }
}
