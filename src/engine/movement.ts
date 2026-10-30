// Movement (ENGINE.md section 5). Formations follow flow fields (Dijkstra cost
// to their objective, recomputed each command cycle) instead of per-formation
// A* paths: the result is the same shortest path on the 8-neighbour grid, but
// one field serves every formation heading to the same objective.
//
// Budget per day (km-equivalents) = rate[slowest role] x season x weather x
// (1 - restDayFraction) x air-superiority factor (x supply for vehicles).
// Entering a cell costs km / (terrain x road) plus the member's riverDelayDays of the
// formation's daily budget on an unbridged major river. Real km covered are
// therefore at most budget x max(terrain x road): the tested invariant.
import type { Ctx } from './ctx';
import { addEvent } from './ctx';
import { seasonIdx } from './ctx';
import { FLAG_RIVER, T } from './terrainClasses';
import { IS_P, NR, RI } from './roles';
import { Mode } from './state';
import { UnitStatus } from './protocol';
import { DAYLIGHT_MARCH_HOURS, ROAD_MIN_TECH, SEA_LIFT_TONNAGE, SEA_MOVEMENT, STACK_PENALTY_CELLS } from './constants';
import { dayOfYear, daylightHours } from './daylight';
import { SEASONS, WEATHERS } from './setup';
import { dijkstra } from './grid';
import { byTech, rule, yearFromTech } from './mech';
import { blockaded } from './naval';

/** What `side` can have at sea at once in the theater (0: no sea movement today), in the units of
 *  seaLoad: shipping tonnage (troopLiftPerShip x ships x seaLiftGrtPerSoldier of the ship era) with
 *  SEA_LIFT_TONNAGE, else troops. */
export function seaLift(ctx: Ctx, side: 0 | 1): number {
  const { S, st } = ctx;
  if (!SEA_MOVEMENT || !S.scenario.rules.naval || blockaded(ctx, side)) return 0;
  const ships = st.fleet[side][RI.ships_major] + st.fleet[side][RI.ships_minor];
  if (!(ships > 0)) return 0;
  const tech = S.poolTech[side].ships;
  const troops = byTech(S.m.naval.troopLiftPerShip, tech) * ships;
  return SEA_LIFT_TONNAGE ? troops * rule(S.m.modelRules.transport.seaLiftGrtPerSoldier, yearFromTech(S.m, tech)) : troops;
}

/** Shipping formation f needs (units of seaLift): personnel x seaLiftGrtPerSoldier of its era plus
 *  its tracked and wheeled land vehicles (seaLiftTonsPerVehicle) with SEA_LIFT_TONNAGE, else personnel. */
export function seaLoad(ctx: Ctx, f: number): number {
  const F = ctx.st.F;
  if (!SEA_LIFT_TONNAGE) return F.personnel[f];
  const mr = ctx.S.members[F.member[f]];
  let t = F.personnel[f] * mr.seaTonsPerSoldier;
  const o = f * NR;
  for (let r = 0; r < NR; r++) if (mr.seaTonsPerRole[r] > 0) t += F.counts[o + r] * mr.seaTonsPerRole[r];
  return t;
}

/** Is cell c a road cell for `side` today? (own place, or own cropland/urban at logistics tech >= 3) */
export function isRoad(ctx: Ctx, side: number, c: number): boolean {
  const { S, st } = ctx;
  if (st.control[c] !== side) return false;
  if (S.placeAt[c] >= 0) return true;
  const cls = S.grid.cls[c];
  return S.members[S.lead[side]].tech.logistics >= ROAD_MIN_TECH && (cls === T.cropland || cls === T.urban);
}

/** Per-side cost-per-km (1 / (terrain x road)) and river extra used by flow fields. */
export function computeInvSpeed(ctx: Ctx, side: 0 | 1): void {
  const { S, sc } = ctx;
  const g = S.grid;
  const inv = sc.invSpeed[side], extra = sc.extra[side];
  const road = S.m.movement.roadBonus.mid;
  const riverKm = S.members[S.lead[side]].riverDelayDays * S.refRate[side];
  // sea cells start impassable; computeField opens them only when needed (see there)
  sc.seaInv[side] = seaLift(ctx, side) > 0 ? S.refRate[side] / Math.max(1e-9, S.m.movement.rate.sea.mid) : Infinity;
  for (let c = 0; c < g.n; c++) {
    if (!g.land[c]) { inv[c] = Infinity; extra[c] = 0; continue; }
    const t = S.terrMove[g.cls[c]] * (isRoad(ctx, side, c) ? road : 1);
    inv[c] = t > 0 ? 1 / t : Infinity;
    extra[c] = (g.flags[c] & FLAG_RIVER) && S.placeAt[c] < 0 ? riverKm : 0;
  }
}

/** Fill field slot k of `side` with the cost-to-reach of cell `target`. */
export function computeField(ctx: Ctx, side: 0 | 1, k: number, target: number): void {
  const { S, st, sc } = ctx;
  const n = S.grid.n;
  const field = st.fields[side].subarray(k * n, (k + 1) * n);
  dijkstra(S.grid, sc.heap, sc.invSpeed[side], sc.extra[side], [target], null, field, null);
  // Land first: armies march where they can. Only when some own formation cannot reach the
  // objective overland (another land mass, already at sea) or only by a march longer than its
  // supply range (in open-country km, as the supply field measures it) is the field rebuilt with
  // sea cells open at sea speed (km at sea cost refRate / seaRate land km-equivalents).
  if (sc.seaInv[side] === Infinity) return;
  const F = st.F, g = S.grid;
  const plains = S.terrMove[T.plains];
  let cut = false;
  for (let f = 0; f < F.n && !cut; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.side[f] !== side) continue;
    const v = field[F.cell[f]];
    // a member without a researched supply range (0, e.g. a synthesized backtest side) only
    // takes ship when it is cut off: its range is unknown, not 1 km
    const mr = S.members[F.member[f]];
    const known = (mr.snap.logistics?.supplyRangeKm?.mid ?? 0) > 0;
    if (v === Infinity || (known && v * plains > mr.supplyRangeKm)) cut = true;
  }
  if (!cut) return;
  const inv = sc.invSpeed[side];
  for (let c = 0; c < g.n; c++) if (!g.land[c]) inv[c] = sc.seaInv[side];
  dijkstra(S.grid, sc.heap, inv, sc.extra[side], [target], null, field, null);
  for (let c = 0; c < g.n; c++) if (!g.land[c]) inv[c] = Infinity;
}

/** Field slot for an objective cell, or -1. */
export function slotOf(ctx: Ctx, side: number, cell: number): number {
  const oc = ctx.st.objCells[side];
  for (let k = 0; k < oc.length; k++) if (oc[k] === cell) return k;
  return -1;
}

/** An enemy fortified place not yet reduced by siege: cannot be entered. */
export function isProtectedEnemyPlace(ctx: Ctx, side: number, c: number): boolean {
  const { S, st } = ctx;
  const p = S.placeAt[c];
  if (p < 0) return false;
  const ctl = st.control[c];
  return ctl !== 255 && ctl !== side && S.places[p].fortified && st.siege[c] < 1;
}

/** Slowest role rate (km/day) of formation f; 0 if it has no mobile roles. */
export function formationRate(ctx: Ctx, f: number): number {
  const F = ctx.st.F;
  const mr = ctx.S.members[F.member[f]];
  const o = f * NR;
  // slowest role with at least half a man/platform; remnants made of fractions of several
  // roles (alive while their SUM is >= 0.5) fall back to the slowest role present at all
  let r0 = Infinity, any = Infinity;
  for (let r = 0; r < NR; r++) {
    const c = F.counts[o + r];
    const v = mr.rate[r];
    if (c <= 0 || !(v > 0)) continue;
    if (v < any) any = v;
    if (c >= 0.5 && v < r0) r0 = v;
  }
  return r0 !== Infinity ? r0 : any === Infinity ? 0 : any;
}

export function usesFuel(ctx: Ctx, f: number): boolean {
  const F = ctx.st.F;
  const mr = ctx.S.members[F.member[f]];
  const o = f * NR;
  for (let r = 0; r < NR; r++) if (F.counts[o + r] >= 0.5 && mr.vehicle[r]) return true;
  return false;
}

/** Seasonal march factor of today: daylight over the march-hours basis (DAYLIGHT_MARCH_HOURS),
 *  else the movement.season table. */
export function seasonMarchFactor(ctx: Ctx): number {
  const { S, st } = ctx;
  const m = S.m.movement;
  if (!DAYLIGHT_MARCH_HOURS) return m.season[SEASONS[seasonIdx(ctx)]].mid;
  const h = daylightHours(S.theaterLat, dayOfYear(S.scenario.startMonth || 1, st.day));
  return Math.min(1, h / Math.max(1e-9, m.marchHoursPerDay.mid));
}

/** Daily movement budget in km-equivalents for formation f (before terrain). */
export function dailyBudget(ctx: Ctx, f: number): number {
  const { S, st } = ctx;
  const F = st.F;
  const side = F.side[f];
  const m = S.m.movement;
  let b = formationRate(ctx, f) * seasonMarchFactor(ctx) * m.weather[WEATHERS[st.weather]].mid * (1 - m.restDayFraction.mid);
  if (st.airHolds[1 - side]) b *= S.m.air.airSuperiorityMovementFactor.mid;
  if (usesFuel(ctx, f) && S.scenario.rules.supply) {
    // out of fuel the vehicles crawl, but the troops can still walk out at foot pace
    const fuelled = b * Math.max(0, Math.min(1, F.supply[f] + F.stock[f]));
    const walk = (b * m.rate.foot.mid) / Math.max(1e-9, formationRate(ctx, f));
    b = Math.max(fuelled, Math.min(b, walk));
  }
  return b;
}

/** Upper bound on real km a formation may cover in a day (for the invariant test). */
export function maxDailyKm(ctx: Ctx, f: number): number {
  const { S } = ctx;
  const m = S.m.movement;
  let sMax = 0, wMax = 0;
  if (DAYLIGHT_MARCH_HOURS) sMax = 1;
  else for (const s of SEASONS) sMax = Math.max(sMax, m.season[s].mid);
  for (const w of WEATHERS) wMax = Math.max(wMax, m.weather[w].mid);
  const air = Math.max(1, S.m.air.airSuperiorityMovementFactor.mid);
  const land = formationRate(ctx, f) * sMax * wMax * (1 - m.restDayFraction.mid) * air * S.maxTerrMove * Math.max(1, m.roadBonus.mid);
  const sea = SEA_MOVEMENT ? m.rate.sea.mid * sMax * wMax * (1 - m.restDayFraction.mid) * air : 0;
  return Math.max(land, sea) + 1e-6;
}

function bearing(ctx: Ctx, a: number, b: number): number {
  const g = ctx.S.grid;
  // Frame contract: math angle in lon/lat space, atan2(dLat, dLon), 0 = east, counter-clockwise
  return Math.atan2(g.lat[b] - g.lat[a], g.lon[b] - g.lon[a]);
}

/** Choose the next cell for f on `field` (downhill), or -1. Sets contact flags via return code. */
function chooseNext(ctx: Ctx, f: number, field: Float32Array, attack: boolean, rout: boolean, lift: number): number {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const side = F.side[f];
  const enemy = 1 - side;
  const cur = F.cell[f];
  const fc = field[cur] - 1e-6;
  let best = -1, bs = Infinity;
  for (let d = 0; d < 8; d++) {
    const j = g.nb[cur * 8 + d];
    if (j < 0) continue;
    // embarking needs free lift; already at sea, moving on at sea is fine
    if (!g.land[j] && (g.land[cur] ? sc.embarked[side] + seaLoad(ctx, f) > lift : lift <= 0)) continue;
    const v = field[j];
    if (!(v < fc)) continue;
    if (sc.occ[enemy][j] > 0 && rout) continue;
    if (!attack && sc.occ[enemy][j] > 0) continue;
    if (!attack && isProtectedEnemyPlace(ctx, side, j)) continue;
    // stay downhill, but prefer less crowded cells so columns spread into a front
    const score = v + STACK_PENALTY_CELLS * g.nbKm[cur * 8 + d] * sc.occ[side][j];
    if (score < bs) { bs = score; best = j; }
  }
  return best;
}

/**
 * A formation that is not marching and went short of supply spreads to the least
 * crowded neighbouring cell (armies dispersed to forage and to use more roads).
 * One cell per day at most, paid from the daily budget.
 */
function disperse(ctx: Ctx, f: number, budget: number): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const side = F.side[f] as 0 | 1;
  const enemy = 1 - side;
  const cur = F.cell[f];
  if (sc.occ[side][cur] <= 1 || F.supply[f] >= 1 || st.day <= 1) return;
  let best = -1, bo = sc.occ[side][cur] - 1, bf = -1, bkm = 0, bcost = 0;
  for (let d = 0; d < 8; d++) {
    const j = g.nb[cur * 8 + d];
    if (j < 0 || !g.land[j] || sc.occ[enemy][j] > 0 || st.control[j] === enemy) continue;
    const o = sc.occ[side][j];
    if (o > bo || (o === bo && st.forage[j] <= bf)) continue;
    const t = S.terrMove[g.cls[j]] * (isRoad(ctx, side, j) ? S.m.movement.roadBonus.mid : 1);
    if (!(t > 0)) continue;
    const km = g.nbKm[cur * 8 + d];
    const cost = km / t + ((g.flags[j] & FLAG_RIVER) && S.placeAt[j] < 0 ? S.members[F.member[f]].riverDelayDays * budget : 0);
    if (cost > budget) continue;
    best = j; bo = o; bf = st.forage[j]; bkm = km; bcost = cost;
  }
  if (best < 0 || bo >= sc.occ[side][cur] - 1) return;
  void bcost;
  sc.occ[side][cur]--;
  sc.occ[side][best]++;
  F.heading[f] = bearing(ctx, cur, best);
  F.cell[f] = best;
  F.next[f] = -1;
  F.prog[f] = 0;
  F.movedKm[f] += bkm;
  F.moved[f] = 1;
  F.stillDays[f] = 0;
  F.status[f] = UnitStatus.Moving;
  enterCell(ctx, side, best);
}

/** Capture an empty cell on entry (control flips immediately). */
export function enterCell(ctx: Ctx, side: 0 | 1, c: number): void {
  const { S, st } = ctx;
  const prev = st.control[c];
  if (prev === side) return;
  st.control[c] = side;
  st.controlVersion++;
  st.lastActivityDay = st.day;
  if (prev !== 255) {
    st.siege[c] = 0;
    // scorched earth: the side that abandons the cell destroys its forage
    for (const mi of S.sideMembers[prev]) if (S.members[mi].specials.has('scorched_earth')) { st.forage[c] = 0; break; }
  }
  const p = S.placeAt[c];
  if (p >= 0) {
    const pl = S.places[p];
    if (prev !== 255 || pl.side !== side) {
      addEvent(ctx, side, 'capture', `${S.sideNames[side]} took ${pl.name}.`, undefined, c);
    }
  }
}

export function movementPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const n = g.n;
  const lift: [number, number] = [seaLift(ctx, 0), seaLift(ctx, 1)];
  sc.embarked[0] = 0; sc.embarked[1] = 0;
  for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && !g.land[F.cell[f]]) sc.embarked[F.side[f]] += seaLoad(ctx, f);
  const seaRate = Math.max(1e-9, S.m.movement.rate.sea.mid);
  for (let f = 0; f < F.n; f++) {
    F.movedKm[f] = 0;
    F.moved[f] = 0;
    F.heading[f] = NaN;
    F.fought[f] = 0;
    F.battle[f] = -1;
    if (!F.alive[f] || !F.onMap[f]) continue;
    const side = F.side[f] as 0 | 1;
    const enemy = 1 - side;
    const mode = F.mode[f];
    let field: Float32Array | null = null;
    if (mode === Mode.Attack || mode === Mode.Defend) {
      const k = slotOf(ctx, side, F.obj[f]);
      if (k >= 0) field = st.fields[side].subarray(k * n, (k + 1) * n);
    } else if (mode === Mode.Retreat || mode === Mode.Rout) {
      if (st.supplyDist[side][F.cell[f]] < Infinity) field = st.supplyDist[side];
    }
    if (!field || (mode !== Mode.Attack && mode !== Mode.Rout && field[F.cell[f]] <= 0)) {
      F.next[f] = -1; F.prog[f] = 0;
      if (mode !== Mode.Rout) disperse(ctx, f, dailyBudget(ctx, f));
      continue;
    }
    const attack = mode === Mode.Attack;
    const rout = mode === Mode.Rout;
    const full = dailyBudget(ctx, f);
    let budget = full;
    let steps = 0;
    while (budget > 1e-9 && steps < 64) {
      steps++;
      const cur = F.cell[f];
      let nx = F.next[f];
      if (nx < 0 || !(field[nx] < field[cur])) {
        nx = chooseNext(ctx, f, field, attack, rout, lift[side]);
        F.next[f] = nx;
        F.prog[f] = 0;
        if (nx < 0) break;
        const t = S.terrMove[g.cls[nx]] * (isRoad(ctx, side, nx) ? S.m.movement.roadBonus.mid : 1);
        let km = 0;
        for (let d = 0; d < 8; d++) if (g.nb[cur * 8 + d] === nx) { km = g.nbKm[cur * 8 + d]; break; }
        const river = (g.flags[nx] & FLAG_RIVER) && S.placeAt[nx] < 0 ? S.members[F.member[f]].riverDelayDays * full : 0;
        // at sea the formation moves at sea speed whatever its land rate
        F.edge[f] = !g.land[nx] ? (km * formationRate(ctx, f)) / seaRate : t > 0 ? km / t + river : Infinity;
      }
      // contact: an enemy formation or an unreduced enemy fortress ahead stops the move
      if (sc.occ[enemy][nx] > 0 || isProtectedEnemyPlace(ctx, side, nx)) {
        F.prog[f] = 0;
        break;
      }
      const edge = F.edge[f];
      if (!isFinite(edge) || edge <= 0) { F.next[f] = -1; break; }
      // real km of this edge
      let km = 0;
      for (let d = 0; d < 8; d++) if (g.nb[cur * 8 + d] === nx) { km = g.nbKm[cur * 8 + d]; break; }
      const remaining = edge - F.prog[f];
      F.heading[f] = bearing(ctx, cur, nx);
      F.moved[f] = 1;
      if (budget >= remaining) {
        budget -= remaining;
        F.movedKm[f] += (km * remaining) / edge;
        sc.occ[side][cur]--;
        sc.occ[side][nx]++;
        if (g.land[cur] !== g.land[nx]) sc.embarked[side] += g.land[nx] ? -seaLoad(ctx, f) : seaLoad(ctx, f);
        F.cell[f] = nx;
        F.next[f] = -1;
        F.prog[f] = 0;
        if (g.land[nx]) enterCell(ctx, side, nx);
      } else {
        F.prog[f] += budget;
        F.movedKm[f] += (km * budget) / edge;
        budget = 0;
      }
    }
    if (F.moved[f]) {
      F.stillDays[f] = 0;
      if (!g.land[F.cell[f]]) F.status[f] = UnitStatus.Embarked;
      else if (mode === Mode.Rout) F.status[f] = UnitStatus.Routing;
      else F.status[f] = UnitStatus.Moving;
    } else {
      if (F.stillDays[f] < 65535) F.stillDays[f]++;
    }
  }
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.moved[f]) continue;
    if (F.stillDays[f] < 65535) F.stillDays[f]++;
  }
}

/** Personnel-weighted check used by tests: P roles only. */
export function personnelOf(ctx: Ctx, f: number): number {
  const F = ctx.st.F;
  let p = 0;
  for (let r = 0; r < NR; r++) if (IS_P[r]) p += F.counts[f * NR + r];
  return p;
}
