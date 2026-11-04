// Territorial control and victory conditions (ENGINE.md section 12).
import type { Ctx } from './ctx';
import { addEvent } from './ctx';
import { Mode } from './state';
import { isProtectedEnemyPlace, enterCell } from './movement';
import { depotPersonnel } from './production';
import { lossFraction } from './formations';
import { rule } from './mech';
import { IS_P, LC, NR } from './roles';
import {
  BATTLE_MODE_NO_CONTACT_DAYS, CAPITAL_CAPTURE_NEEDS_REACH, CAPITAL_SHOCK_REAL_ONLY, COLLAPSE_NEEDS_REAL_FALL, COLLAPSE_SURRENDER, CREWED_FORMATIONS, ENCIRCLED_FLIP_NEEDS_SUPPLY, MEMBER_COLLAPSE, MEMBER_COLLAPSE_MIN_SHARE, MEMBER_COLLAPSE_RECOVERS, MEMBER_MORALE_COLLAPSE, OBJECTIVE_KIND_EXPLICIT, STALEMATE_DAYS, TIME_LIMIT_TERRITORY_MARGIN,
} from './constants';

/**
 * Control rules: a cell occupied by one side only becomes that side's; an empty
 * cell next to formations of one side only follows them (zone of control);
 * enemy cells cut off from every enemy supply source and touching own ground
 * fall one ring per day (pockets surrender). Unreduced enemy fortresses only
 * fall to siege, unless their state has no formation left (UNARMED_FORTRESS_OPEN).
 */
export function controlPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const [c0, c1] = sc.claim;
  c0.fill(0); c1.fill(0);
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.mode[f] === Mode.Rout) continue;
    if (CREWED_FORMATIONS && F.personnel[f] < 0.5) continue;
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
    // Captured only once an enemy formation has reached it (stood on it, or next to it as the
    // besieger whose zone of control takes a reduced fortress): a capital that passed by
    // encirclement alone, with no enemy force near, takes no city.
    const enemyHolds = st.control[mr.capitalCell] === 1 - mr.side && sc.occ[mr.side][mr.capitalCell] === 0;
    if (!enemyHolds) ms.capitalReached = false;
    else if (sc.claim[1 - mr.side][mr.capitalCell] > 0) ms.capitalReached = true;
    const held = enemyHolds && (ms.capitalReached || !CAPITAL_CAPTURE_NEEDS_REACH);
    if (held) {
      ms.capitalHeldDays++;
      if (!ms.capitalLost) {
        ms.capitalLost = true;
        // a backtest case's synthesized start base is not a capital: no national morale shock
        if (CAPITAL_SHOCK_REAL_ONLY && !mr.capitalReal) continue;
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

/** The collapsed side's army surrenders: encircledSurrenderShare (era of each formation's member) of
 *  every formation still on the map (personnel and equipment) is booked as captured. Formations in depots or not yet
 *  arrived are left out (they were not with the army that broke). */
function surrenderArmy(ctx: Ctx, side: number): void {
  const { S, st } = ctx;
  const F = st.F;
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.side[f] !== side) continue;
    const share = Math.min(1, Math.max(0, rule(S.m.modelRules.surrender.encircledSurrenderShare, S.members[F.member[f]].ruleYear)));
    lossFraction(ctx, f, share, LC.captured);
  }
}

/** MEMBER_COLLAPSE: mark members of `side` that fell below the collapse share of what they
 *  fielded (once, with an event while allies fight on) and say whether the side as a whole has
 *  collapsed: every member with a real share broken. Null when the side has no such member. */
function membersCollapsed(ctx: Ctx, side: 0 | 1): boolean | null {
  const { S, st } = ctx;
  const F = st.F;
  const now = new Float64Array(S.members.length);
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.side[f] === side) now[F.member[f]] += F.personnel[f];
  let total = 0;
  for (const mr of S.members) if (mr.side === side) total += st.members[mr.idx].fielded;
  if (!(total > 0)) return null;
  let counted = 0, standing = 0;
  for (const mr of S.members) {
    const ms = st.members[mr.idx];
    if (mr.side !== side || ms.fielded < MEMBER_COLLAPSE_MIN_SHARE * total) continue;
    counted++;
    let p = now[mr.idx];
    for (let r = 0; r < NR; r++) if (IS_P[r]) p += ms.depot[r];
    // MEMBER_COLLAPSE_RECOVERS: standing is judged afresh each day (reserves and recruits can bring a
    // broken member back over the line); the event fires once
    const below = p < S.rules.collapsePersonnel * ms.fielded;
    if (MEMBER_COLLAPSE_RECOVERS) ms.broken = below;
    else if (below) ms.broken = true;
    if (ms.broken && !ms.brokeOnce) {
      ms.brokeOnce = true;
      addEvent(ctx, (1 - side) as 0 | 1, 'rout', `${mr.name}'s army collapsed (personnel below ${Math.round(S.rules.collapsePersonnel * 100)}% of all it fielded).`, 'Its allies fight on.');
    }
    if (!ms.broken) standing++;
  }
  return counted === 0 ? null : standing === 0;
}

/** MEMBER_MORALE_COLLAPSE: whether every member of `side` that carries a real share (the members
 *  MEMBER_COLLAPSE counts) has fallen: broken on personnel, or its formations on the map below the
 *  morale line. A member with nothing on the map yet that is not broken still stands (its army is
 *  marching or sailing in). True when the side has no such member. */
function membersMoraleFallen(ctx: Ctx, side: 0 | 1, line: number): boolean {
  const { S, st } = ctx;
  const F = st.F;
  const w = new Float64Array(S.members.length), mw = new Float64Array(S.members.length);
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.side[f] !== side) continue;
    w[F.member[f]] += F.curW[f];
    mw[F.member[f]] += F.morale[f] * F.curW[f];
  }
  let total = 0;
  for (const mr of S.members) if (mr.side === side) total += st.members[mr.idx].fielded;
  for (const mr of S.members) {
    const ms = st.members[mr.idx];
    if (mr.side !== side || ms.fielded < MEMBER_COLLAPSE_MIN_SHARE * total || ms.broken) continue;
    if (!(w[mr.idx] > 0) || mw[mr.idx] / w[mr.idx] >= line) return false;
  }
  return true;
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
  const collapsed: [boolean, boolean] = [false, false];
  for (const s of [0, 1] as const) {
    const o = (1 - s) as 0 | 1;
    const no = now[o];
    if (V.armyCollapse) {
      const base = st.startPersonnel[o] + st.arrivals[o];
      const baseW = st.startW[o] + st.addedW[o];
      const pooled = base > 0 ? no.personnel < S.rules.collapsePersonnel * base : baseW > 0 && no.w < S.rules.collapsePersonnel * baseW;
      const coalition = MEMBER_COLLAPSE && S.members.filter((mr) => mr.side === o).length > 1;
      const each = coalition ? membersCollapsed(ctx, o) : null;
      const fell = each ?? pooled;
      if (fell && (base > 0 || baseW > 0)) {
        wins[s] = each ? `${S.sideNames[o]}'s army collapsed (every member below ${Math.round(S.rules.collapsePersonnel * 100)}% of all it fielded)`
          : `${S.sideNames[o]}'s army collapsed (personnel below ${Math.round(S.rules.collapsePersonnel * 100)}% of all it fielded)`;
      }
      // morale collapse needs a real fall: below the threshold AND at least one lost battle's morale
      // shock below where the side started (Iraq 1991 starts at 0.20; a side starting at the
      // threshold must not "collapse" after a trivial dip). A coalition's morale breaks only when
      // every counted member has fallen (MEMBER_MORALE_COLLAPSE): the pooled figure covers only
      // what is on the map, so a vanguard member could end the war before the main army landed.
      else {
        const line = COLLAPSE_NEEDS_REAL_FALL
          ? Math.min(S.rules.collapseMorale, st.startMorale[o] - S.m.morale.defeatShock.mid)
          : Math.min(S.rules.collapseMorale, st.startMorale[o]);
        if (no.formations > 0 && no.morale < line && !(coalition && MEMBER_MORALE_COLLAPSE && !membersMoraleFallen(ctx, o, line))) {
          wins[s] = `${S.sideNames[o]}'s morale collapsed (${no.morale.toFixed(2)})`;
        }
      }
      collapsed[s] = wins[s] !== null;
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
  for (const s of [0, 1] as const) if (wins[s]) {
    if (COLLAPSE_SURRENDER && collapsed[s]) surrenderArmy(ctx, 1 - s);
    end(ctx, s, wins[s]!);
    return;
  }
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
