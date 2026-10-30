// Combat power and tactical resolution (ENGINE.md sections 3 and 4).
import type { Battle, Ctx } from './ctx';
import { addEvent, rebuildOccupancy } from './ctx';
import { byTech, clamp, matrix, rule } from './mech';
import { NR, RI, LC, IS_P, IS_SUPPORT_FIRE } from './roles';
import { Mode } from './state';
import { UnitStatus } from './protocol';
import { FLAG_RIVER } from './terrainClasses';
import {
  BATTLE_ROUND_LOSS_CAP, FEIGNED_RETREAT_INITIATIVE_THRESHOLD, MAX_BATTLE_EVENTS_PER_DAY,
  PHALANX_FLANK_THRESHOLD, PRECISION_MIN_TECH, SUPPLY_FACTOR_MIN_TECH, MORALE_ON_ENGAGED_BASIS, PURSUE_WITHDRAWING,
  DEFENSE_ALTERNATIVES_MAX, ASSAULT_ONLY_REAL_FORTS, PREPARED_FROM_CASE, FIELD_FORT_NEEDS_CASE_PREP, BEATEN_LEAVE_CELL,
  RANGE_INTEGER_CLASS, RIVER_FROM_CASE, SIMULTANEOUS_BREAK_BY_SEVERITY, SUBDAY_REINFORCEMENTS, EXPLAIN_LOCAL_POWER, PURSUIT_FROM_MODEL_RULES, SURRENDER_SHARE_FROM_MODEL_RULES, CREWED_FORMATIONS, EMBARKED_NAVAL_ONLY,
  PURSUIT_MANOEUVRE_ROLES_ONLY, PURSUIT_AIR_SAME_UNITS, SURPRISE_DAY_ONE_ONLY } from './constants';
import { isProtectedEnemyPlace } from './movement';
import { lossFraction } from './formations';

// ---------------------------------------------------------------- detection

function joinCell(ctx: Ctx, b: Battle, c: number, inBattleCell: boolean, sideOnly: number): void {
  const { st, sc } = ctx;
  const F = st.F;
  for (const s of [0, 1] as const) {
    if (sideOnly >= 0 && s !== sideOnly) continue;
    for (let f = sc.head[s][c]; f >= 0; f = sc.nextInCell[f]) {
      if (!F.alive[f] || F.battle[f] >= 0) continue;
      const mode = F.mode[f];
      if (!inBattleCell && (mode === Mode.Rout || mode === Mode.Retreat)) continue;
      F.battle[f] = b.id;
      b.parts[s].push(f);
    }
  }
}

function createBattle(ctx: Ctx, cell: number, att: 0 | 1): Battle | null {
  const { S, st, sc } = ctx;
  const F = st.F;
  const g = S.grid;
  const b: Battle = {
    id: sc.battles.length, cell, att, parts: [[], []], airSorties: [0, 0], airPow: [0, 0], airLossFrac: [0, 0],
    casualties: [0, 0], winner: -1, endRound: 0,
  };
  joinCell(ctx, b, cell, true, -1);
  for (const s of [0, 1] as const) {
    const corps = S.sideMembers[s].some((mi) => S.members[mi].specials.has('corps_system'));
    for (let d = 0; d < 8; d++) {
      const j = g.nb[cell * 8 + d];
      if (j < 0) continue;
      joinCell(ctx, b, j, false, s);
      if (corps) for (let d2 = 0; d2 < 8; d2++) {
        const k = g.nb[j * 8 + d2];
        if (k >= 0 && k !== cell) joinCell(ctx, b, k, false, s);
      }
    }
  }
  if (!b.parts[0].length || !b.parts[1].length) {
    for (const s of [0, 1]) for (const f of b.parts[s]) F.battle[f] = -1;
    return null;
  }
  sc.battleAt[cell] = b.id;
  sc.battles.push(b);
  return b;
}

/** Find today's battles: both sides in one cell, or an attacking formation blocked by enemies. */
export function detectBattles(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  for (const b of sc.battles) sc.battleAt[b.cell] = -1;
  sc.battles.length = 0;
  rebuildOccupancy(ctx);
  for (let f = 0; f < F.n; f++) F.battle[f] = -1;
  const g = S.grid;
  // formations embarked on sea cells meet the enemy only through naval interception (naval.ts)
  const afloat = (c: number) => EMBARKED_NAVAL_ONLY && !g.land[c];
  // 1. cells holding both sides
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.battle[f] >= 0) continue;
    const c = F.cell[f], s = F.side[f];
    if (afloat(c)) continue;
    if (sc.occ[1 - s][c] <= 0 || sc.battleAt[c] >= 0) continue;
    const ctl = st.control[c];
    const att = (ctl === 0 || ctl === 1 ? 1 - ctl : s) as 0 | 1;
    createBattle(ctx, c, att);
  }
  // 2. attacks on adjacent enemy cells
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.battle[f] >= 0 || F.mode[f] !== Mode.Attack) continue;
    const t = F.next[f];
    const s = F.side[f] as 0 | 1;
    if (t < 0 || sc.occ[1 - s][t] <= 0 || afloat(t)) continue;   // landing on an enemy-held shore is a land battle
    const bi = sc.battleAt[t];
    if (bi >= 0) {
      const b = sc.battles[bi];
      F.battle[f] = b.id;
      b.parts[s].push(f);
    } else {
      createBattle(ctx, t, s);
    }
  }
}

// ---------------------------------------------------------------- resolution

export interface SideProf {
  weapons: number; armor: number; disp: number; isr: number; comms: number; cyber: number;
  initiative: number; flanking: number; combinedArms: number; maxRange: number;
  baseCas: number; alpha: number; pursuit: number; capture: number;
  specials: Set<string>; heads: number; w: number; mountedW: number; airTech: number;
}

export function profile(ctx: Ctx, list: number[]): SideProf {
  const { S, st } = ctx;
  const F = st.F;
  const p: SideProf = {
    weapons: 0, armor: 0, disp: 0, isr: 0, comms: 0, cyber: 0, initiative: 0, flanking: 0, combinedArms: 0, maxRange: 0,
    baseCas: 0, alpha: 0, pursuit: 0, capture: 0, specials: new Set(), heads: 0, w: 0, mountedW: 0, airTech: 0,
  };
  let tw = 0;
  for (const f of list) {
    const mr = S.members[F.member[f]];
    const w = Math.max(F.curW[f], 1e-9);
    tw += w;
    p.weapons += mr.tech.weapons * w; p.armor += mr.tech.armor * w; p.disp += mr.dispersion * w;
    p.isr += mr.tech.isr * w; p.comms += mr.tech.communications * w; p.cyber += mr.tech.cyber * w;
    p.airTech += mr.tech.air * w;
    p.initiative += mr.w.initiative * w; p.flanking = Math.max(p.flanking, mr.w.flanking); p.combinedArms += mr.w.combinedArms * w;
    p.baseCas += mr.baseCas * w; p.alpha += mr.alpha * w; p.pursuit += mr.pursuit * w; p.capture += mr.capture * w;
    for (const sp of mr.specials) p.specials.add(sp);
    const o = f * NR;
    for (let r = 0; r < NR; r++) {
      const c = F.counts[o + r];
      if (c < 0.5) continue;
      p.heads += c;
      const rr = RANGE_INTEGER_CLASS ? mr.rangeClass[r] : mr.range[r];
      if (rr > p.maxRange && mr.tli[r] > 0) p.maxRange = rr;
      // pursuit is by mobile manoeuvre troops (cavalry, vehicles); horse-drawn or towed artillery,
      // missile launchers and air defence do not chase a beaten enemy
      if (mr.mounted[r] && !(PURSUIT_MANOEUVRE_ROLES_ONLY && IS_SUPPORT_FIRE[r])) p.mountedW += c * mr.tli[r];
    }
    p.w += F.curW[f];
  }
  for (const k of ['weapons', 'armor', 'disp', 'isr', 'comms', 'cyber', 'airTech', 'initiative', 'combinedArms', 'baseCas', 'alpha', 'pursuit', 'capture'] as const) (p as any)[k] /= tw || 1;
  if (p.disp <= 0) p.disp = 1;
  return p;
}

/** Raw lethality of f against an enemy profile (no morale/supply/posture): sum count x TLI x quality x training. */
function rawPower(ctx: Ctx, f: number, opening: boolean, enemyMaxRange: number, mountedF: number, massedArt: number): number {
  const F = ctx.st.F;
  const mr = ctx.S.members[F.member[f]];
  const o = f * NR;
  let sum = 0;
  for (let r = 0; r < NR; r++) {
    const c = F.counts[o + r];
    if (c <= 0) continue;
    if (opening && (RANGE_INTEGER_CLASS ? mr.rangeClass[r] : mr.range[r]) < enemyMaxRange) continue;
    let v = c * mr.tli[r] * mr.qF[r] * mr.tF[r];
    if (mr.mounted[r]) v *= mountedF;
    if (r === RI.artillery) v *= massedArt;
    sum += v;
  }
  return sum;
}

const gapF = (perLevel: number, own: number, enemy: number) => Math.max(0.05, 1 + perLevel * clamp(own - enemy, -5, 5));

/** Battle power of f against an enemy profile as the battle model rates it before the situation:
 *  count x TLI x quality x training (rawPower, no opening round), x command, x the tech factors
 *  (armour matrix over enemy dispersion, ISR/EW/cyber gaps, precision). Posture, terrain, morale,
 *  supply and combined arms are left out: they depend on the battle, and the AI's required ratio
 *  is the rule of thumb that already prices the defender's advantage. Used by the AI (ai.ts). */
export function aiPower(ctx: Ctx, f: number, e: SideProf): number {
  const m = ctx.S.m;
  const mr = ctx.S.members[ctx.st.F.member[f]];
  const t = mr.tech;
  let k = matrix(m.lethality.armorMatrix, t.weapons, e.armor) / e.disp;
  k *= gapF(m.modern.isrPerLevel.mid, t.isr, e.isr) * gapF(m.modern.ewPerLevel.mid, t.communications, e.comms) * gapF(m.modern.cyberPerLevel.mid, t.cyber, e.cyber);
  if (t.weapons >= PRECISION_MIN_TECH) k *= gapF(m.modern.precisionStrikePerLevel.mid, t.weapons, e.weapons);
  return rawPower(ctx, f, false, 0, 1, 1) * mr.commandF * k;
}

export function resolveBattles(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const decisive: { b: Battle; size: number; why: string }[] = [];
  for (const b of sc.battles) {
    const why = resolveBattle(ctx, b);
    if (b.winner >= 0) decisive.push({ b, size: b.parts[0].length + b.parts[1].length, why });
  }
  if (sc.battles.length) st.lastActivityDay = st.day;
  decisive.sort((a, b) => b.size - a.size || a.b.id - b.b.id);
  let n = 0;
  for (const d of decisive) {
    if (n >= MAX_BATTLE_EVENTS_PER_DAY) break;
    n++;
    const w = d.b.winner as 0 | 1;
    const l = 1 - w;
    const cas = d.b.casualties;
    addEvent(ctx, w, 'battle',
      `${S.sideNames[w]} beat ${S.sideNames[l]} (${d.b.parts[w].length} vs ${d.b.parts[l].length} formations; losses ${Math.round(cas[w]).toLocaleString('en-US')} vs ${Math.round(cas[l]).toLocaleString('en-US')}).`,
      d.why, d.b.cell);
  }
}

function resolveBattle(ctx: Ctx, b: Battle): string {
  const { S, st, rng } = ctx;
  const F = st.F;
  const m = S.m;
  const g = S.grid;
  const H = S.H;
  const cell = b.cell;
  const att = b.att, def = (1 - att) as 0 | 1;
  const prof: [SideProf, SideProf] = [profile(ctx, b.parts[0]), profile(ctx, b.parts[1])];
  const opening = b.parts[att].every((f) => F.engagedDays[f] === 0);
  // surprise belongs to the opening of the offensive, the side's day 1, not to every fresh
  // formation's first battle all campaign (QA round 3, C6)
  const surprised = (s: number) => !!S.opts.surprise?.[s] && (SURPRISE_DAY_ONE_ONLY ? ctx.st.day === 1 : opening);
  for (const s of [0, 1]) for (const f of b.parts[s]) if (F.engagedDays[f] === 0) { F.engLoss[f] = 0; F.feignUsed[f] = 0; }
  const cls = g.cls[cell];
  const place = S.placeAt[cell];
  const fortified = place >= 0 && S.places[place].fortified && st.control[cell] === def;
  // storming walls (assaultFactor) vs attacking a field position (power factor only)
  const stormed = fortified && !(ASSAULT_ONLY_REAL_FORTS && S.places[place].fieldWorks);
  const se = S.specialEffect;
  const fixMult = new Float64Array(b.parts[0].length + b.parts[1].length);
  const sideOff = [0, b.parts[0].length];
  // combined arms per side from aggregated role power shares
  const ca: [number, number] = [1, 1];
  const techRatioParts: [number, number] = [0, 0];
  const postureLog: [number, number] = [0, 0];
  const cmdLog: [number, number] = [0, 0];
  for (const s of [0, 1] as const) {
    const e = prof[1 - s];
    const shares = ctx.sc.roleTmp; shares.fill(0);
    let tot = 0;
    for (const f of b.parts[s]) {
      const mr = S.members[F.member[f]];
      const o = f * NR;
      for (let r = 0; r < NR; r++) { const v = F.counts[o + r] * mr.tli[r]; shares[r] += v; tot += v; }
    }
    let hh = 0;
    if (tot > 0) for (let r = 0; r < NR; r++) hh += (shares[r] / tot) ** 2;
    ca[s] = 1 + m.combat.combinedArmsBonus.mid * prof[s].combinedArms * (tot > 0 ? 1 - hh : 0);
    let wsum = 0;
    sideOff[s] = s === 0 ? 0 : b.parts[0].length;
    b.parts[s].forEach((f, i) => {
      const mr = S.members[F.member[f]];
      const t = mr.tech;
      let k = matrix(m.lethality.armorMatrix, t.weapons, e.armor) / e.disp;
      const tech = k;
      k *= gapF(m.modern.isrPerLevel.mid, t.isr, e.isr) * gapF(m.modern.ewPerLevel.mid, t.communications, e.comms) * gapF(m.modern.cyberPerLevel.mid, t.cyber, e.cyber);
      if (t.weapons >= PRECISION_MIN_TECH) k *= gapF(m.modern.precisionStrikePerLevel.mid, t.weapons, e.weapons);
      const techAll = k;
      k *= mr.commandF;
      let posture = 1;
      if (s === att) {
        posture *= S.terrAttack[cls];
        const river = S.battleMode && RIVER_FROM_CASE ? !!S.opts.riverCrossing : F.cell[f] !== cell && (g.flags[cell] & FLAG_RIVER) !== 0;
        if (river) posture *= m.combat.riverCrossingFactor.mid;
        if (surprised(s)) posture *= m.combat.surpriseFactor.mid;
      } else {
        const prepared = S.battleMode && PREPARED_FROM_CASE ? !!S.opts.prepared?.[s] && F.mode[f] !== Mode.Rout
          : F.stillDays[f] >= 1 && F.mode[f] !== Mode.Rout;
        const alt = [
          prepared ? m.combat.defensePostureFactor.mid : 1,
          fortified && F.cell[f] === cell ? mr.fortF : 1,
          mr.specials.has('field_fortification') && !(FIELD_FORT_NEEDS_CASE_PREP && S.opts.unprepared?.[s]) ? se('fieldFortification') : 1,
        ];
        posture *= DEFENSE_ALTERNATIVES_MAX ? Math.max(...alt) : alt[0] * alt[1] * alt[2];
        if (mr.specials.has('defense_in_depth')) posture *= se('defenseInDepth');
        if (S.owner0[F.cell[f]] === mr.idx) posture *= mr.homeDefense;
        if (surprised(s)) posture *= m.combat.surpriseFactor.mid;
      }
      if (mr.specials.has('phalanx')) posture *= e.flanking > PHALANX_FLANK_THRESHOLD ? se('phalanxFlank') : se('phalanxFront');
      if (mr.specials.has('human_wave')) posture *= se('humanWavePower');
      k *= posture;
      fixMult[sideOff[s] + i] = k;
      const w = Math.max(F.curW[f], 1e-9);
      wsum += w;
      techRatioParts[s] += Math.log(Math.max(1e-12, techAll)) * w;
      postureLog[s] += Math.log(Math.max(1e-12, posture)) * w;
      cmdLog[s] += Math.log(Math.max(1e-12, mr.commandF * ca[s])) * w;
      void tech;
    });
    techRatioParts[s] /= wsum || 1; postureLog[s] /= wsum || 1; cmdLog[s] /= wsum || 1;
  }
  const active: [Uint8Array, Uint8Array] = [new Uint8Array(b.parts[0].length).fill(1), new Uint8Array(b.parts[1].length).fill(1)];
  const mountedF = S.terrMounted[cls];
  const massed: [number, number] = [prof[0].specials.has('massed_artillery') ? se('massedArtillery') : 1, prof[1].specials.has('massed_artillery') ? se('massedArtillery') : 1];
  const startHeads: [number, number] = [prof[0].heads, prof[1].heads];
  const startPers: [number, number] = [0, 0];
  for (const s of [0, 1] as const) for (const f of b.parts[s]) startPers[s] += F.personnel[f];
  const startP: [number, number] = [0, 0];
  let ended = false;
  const P: [number, number] = [0, 0];
  const airShare: [number, number] = [0, 0];
  const groundMax: [number, number] = [0, 0];
  // Each side's loss rate uses the enemy's FIRING power over its own FULL power. Outside the
  // opening round both are the same, giving ENGINE.md's R^alpha / R^-alpha exactly; in the
  // opening round out-ranged roles do not fire but still count as targets, so a side that
  // cannot reach the enemy inflicts nothing instead of making R infinite.
  const Pfull: [number, number] = [0, 0];
  // a sub-day reinforcement is absent from the rounds before it arrives
  const absent = (f: number, round: number) => SUBDAY_REINFORCEMENTS && F.joinDay[f] === st.day && round < F.joinRound[f];
  for (let round = 0; round < H && !ended; round++) {
    const open = opening && round === 0;
    for (const s of [0, 1] as const) {
      let sum = 0, full = 0;
      b.parts[s].forEach((f, i) => {
        if (!active[s][i] || !F.alive[f] || absent(f, round)) return;
        const mr = S.members[F.member[f]];
        const k0 = fixMult[sideOff[s] + i] * (0.5 + F.morale[f]);
        // ammo/fuel shortage cuts the power a formation FIRES with, not its size as a target:
        // with it in the denominator too, an unsupplied army had Pfull 0 and lost the round cap
        // to anything (a bronze-age force shredded 47 out-of-supply modern formations)
        const supF = mr.tech.weapons >= SUPPLY_FACTOR_MIN_TECH && S.scenario.rules.supply ? clamp(F.supply[f] + F.stock[f], 0, 1) : 1;
        const fullV = rawPower(ctx, f, false, 0, mountedF, massed[s]) * k0;
        let v = (open ? rawPower(ctx, f, true, prof[1 - s].maxRange, mountedF, massed[s]) * k0 : fullV) * supF;
        if (open && mr.specials.has('horse_archery')) v *= se('horseArcheryOpening');
        sum += v;
        full += fullV;
      });
      sum *= ca[s];
      full *= ca[s];
      const air = b.airPow[s];
      P[s] = sum + air;
      Pfull[s] = full + air;
      if (full > groundMax[s]) groundMax[s] = full;
      airShare[s] = P[s] > 0 ? air / P[s] : 0;
      if (round === 0) startP[s] = Pfull[s];
    }
    if (P[0] <= 0 && P[1] <= 0) break;
    const loss: [number, number] = [0, 0];
    const Rd = Math.max(P[att], 0) / Math.max(Pfull[def], 1e-12);   // attacker fire vs defender
    const Ra = Math.max(P[def], 0) / Math.max(Pfull[att], 1e-12);   // defender fire vs attacker
    loss[def] = (prof[def].baseCas * Math.pow(Rd, prof[def].alpha)) / H * rng.lognormal(S.rules.noiseSigma);
    loss[att] = (prof[att].baseCas * Math.pow(Ra, prof[att].alpha)) / H * rng.lognormal(S.rules.noiseSigma);
    // storming a fortified place: siege.assaultFactor multiplies the attacker's loss rate
    if (stormed) loss[att] *= m.siege.assaultFactor.mid;
    for (const s of [0, 1] as const) {
      if (prof[s].specials.has('human_wave')) loss[s] *= se('humanWaveOwnLoss');
      // feigned retreat: once per battle, in the second round, the pursuers pay
      const e = 1 - s;
      if (round === 1 && prof[s].specials.has('feigned_retreat') && prof[e].initiative < FEIGNED_RETREAT_INITIATIVE_THRESHOLD
        && b.parts[s].some((f) => !F.feignUsed[f])) {
        loss[e] *= se('feignedRetreatPursuerLoss');
        for (const f of b.parts[s]) F.feignUsed[f] = 1;
      }
    }
    for (const s of [0, 1] as const) {
      const l = Math.min(BATTLE_ROUND_LOSS_CAP, loss[s]);
      if (l <= 0) continue;
      const lAir = l * airShare[1 - s], lGround = l - lAir;
      b.parts[s].forEach((f, i) => {
        if (!active[s][i] || !F.alive[f] || absent(f, round)) return;
        const mr = S.members[F.member[f]], ms = st.members[F.member[f]];
        const before = F.personnel[f];
        lossFraction(ctx, f, lGround, LC.combat);
        if (lAir > 0) lossFraction(ctx, f, lAir / Math.max(1e-9, 1 - lGround), LC.air);
        b.casualties[s] += before - F.personnel[f];
        const lStart = MORALE_ON_ENGAGED_BASIS ? l * (1 - F.engLoss[f]) : l;   // share of starting strength
        F.morale[f] = Math.max(0, F.morale[f] - lStart * (mr.morale0 / ms.breakpoint));
        F.engLoss[f] = 1 - (1 - F.engLoss[f]) * (1 - l);
      });
    }
    // thresholds
    for (const s of [0, 1] as const) {
      const e = 1 - s;
      let any = false;
      b.parts[s].forEach((f, i) => {
        if (!active[s][i]) return;
        if (!F.alive[f]) { active[s][i] = 0; return; }
        if (absent(f, round)) { any = true; return; }
        const mr = S.members[F.member[f]], ms = st.members[F.member[f]];
        if (F.engLoss[f] >= ms.breakpoint || F.morale[f] <= 0.001) {
          active[s][i] = 0;
          // horse archers with the mobility edge break contact instead of routing
          const mobEdge = mr.specials.has('horse_archery') && maxRate(ctx, b.parts[s]) > maxRate(ctx, b.parts[e]);
          F.mode[f] = mobEdge ? Mode.Retreat : Mode.Rout;
        } else if (F.engLoss[f] >= ms.retreat) {
          active[s][i] = 0;
          F.mode[f] = Mode.Retreat;
        } else any = true;
      });
      if (!any) { ended = true; b.winner = e as 0 | 1; b.endRound = round + 1; }
    }
    if (ended && active[0].every((x) => !x) && active[1].every((x) => !x)) {
      b.winner = -1;
      if (SIMULTANEOUS_BREAK_BY_SEVERITY) {
        // both broke this round: the side further past its breakpoint lost the field
        const sev = [0, 1].map((s) => {
          let num = 0, den = 0;
          for (const f of b.parts[s]) { const w = Math.max(F.startW[f], 1e-9); num += w * F.engLoss[f] / st.members[F.member[f]].breakpoint; den += w; }
          return den > 0 ? num / den : 0;
        });
        if (sev[0] !== sev[1]) b.winner = sev[0] > sev[1] ? 1 : 0;
      }
    }
  }
  // a side that brought no personnel cannot win (platforms without crews hold nothing)
  if (CREWED_FORMATIONS && b.winner >= 0 && startPers[b.winner as 0 | 1] < 0.5) {
    const o = (1 - b.winner) as 0 | 1;
    b.winner = startPers[o] >= 0.5 ? o : -1;
    ended = b.winner >= 0;
  }
  // ---- after the day
  const parts = b.parts;
  for (const s of [0, 1]) for (const f of parts[s]) {
    F.fought[f] = 1;
    if (F.alive[f]) {
      F.status[f] = F.mode[f] === Mode.Rout ? UnitStatus.Routing : UnitStatus.Engaged;
      if (F.engagedDays[f] < 65535) F.engagedDays[f]++;
    }
  }
  if (ended) {
    if (b.winner >= 0) {
      const w = b.winner as 0 | 1, l = 1 - w;
      const wp = prof[w];
      // air power is in battle power units (per enemy dispersion) and mountedW / w in raw TLI, so
      // the air share comes from the battle's power split (airShare) and the ground part from TLI
      const mobileShare = PURSUIT_AIR_SAME_UNITS
        ? clamp(airShare[w] + (1 - airShare[w]) * wp.mountedW / Math.max(1e-9, wp.w), 0, 1)
        : clamp((wp.mountedW + b.airPow[w]) / Math.max(1e-9, wp.w + b.airPow[w]), 0, 1);
      let exploit = 1;
      if (wp.specials.has('blitzkrieg')) exploit *= se('blitzExploitation');
      if (wp.specials.has('deep_battle')) exploit *= se('deepBattleBreakthrough');
      const mounted = wp.pursuit * mobileShare;
      const MR = m.modelRules;
      // foot pursuit (sourced): a foot-only winner still takes footPursuitLossFloor of a broken
      // enemy, but no more than leaves pursuitDisengageShare of the loser's start strength
      // standing (the share that gets away); the mounted/air term is not capped by it
      const lostShare = startPers[l] > 0 ? clamp(b.casualties[l] / startPers[l], 0, 1) : 0;
      const footFor = (year: number) => Math.min(rule(MR.battle.footPursuitLossFloor, year),
        Math.max(0, 1 - rule(MR.battle.pursuitDisengageShare, year) - lostShare));
      const pursuitFor = (year: number) => clamp((PURSUIT_FROM_MODEL_RULES ? Math.max(mounted, footFor(year)) : mounted) * exploit, 0, 1);
      const loserEscapes = maxRate(ctx, parts[l]) > maxRate(ctx, parts[w]);
      for (const f of parts[l]) {
        if (!F.alive[f]) continue;
        const mr = S.members[F.member[f]];
        const pursuit = pursuitFor(mr.ruleYear);
        F.morale[f] = Math.max(0, F.morale[f] - m.morale.defeatShock.mid);
        const mobEdge = mr.specials.has('horse_archery') && loserEscapes;
        const pursued = F.mode[f] === Mode.Rout || (PURSUE_WITHDRAWING && F.mode[f] === Mode.Retreat && !mobEdge);
        if (F.mode[f] === Mode.Rout) { st.acc.routs[l]++; F.routDays[f] = 0; }
        if (pursued) {
          const guerrilla = mr.specials.has('guerrilla') && S.owner0[F.cell[f]] === mr.idx;
          const cap = guerrilla ? 0 : clamp(wp.capture, 0, 1);
          const before = F.personnel[f];
          lossFraction(ctx, f, pursuit * cap, LC.captured);
          if (pursuit * cap < 1) lossFraction(ctx, f, (pursuit * (1 - cap)) / (1 - pursuit * cap), LC.pursuit);
          b.casualties[l] += before - F.personnel[f];
        }
        if (F.alive[f] && F.mode[f] !== Mode.Retreat && F.mode[f] !== Mode.Rout) {
          F.mode[f] = Mode.Retreat;
        }
        F.next[f] = -1;
        F.prog[f] = 0;
        if (BEATEN_LEAVE_CELL && !S.battleMode && F.alive[f] && F.onMap[f] && F.cell[f] === cell) leaveCell(ctx, f, cell, b);
      }
      st.acc.battleWins[w]++;
    }
  }
  // strike aircraft lost flying battle support
  for (const s of [0, 1] as const) {
    if (b.airSorties[s] > 0 && b.airLossFrac[s] > 0) {
      const lost = b.airSorties[s] * b.airLossFrac[s];
      const pool = st.air[s];
      let tot = pool[RI.aircraft_strike] + pool[RI.helicopters] + pool[RI.drones];
      if (tot > 0) {
        const k = Math.min(1, lost / tot);
        for (const r of [RI.aircraft_strike, RI.helicopters, RI.drones]) { const l = pool[r] * k; pool[r] -= l; st.platformLosses[s] += l; }
      }
      void tot;
    }
  }
  // accumulators for the explanation (side 0 vs side 1)
  const wgt = startHeads[0] + startHeads[1];
  const a = st.acc;
  a.battles++;
  a.tech[0] += wgt * (techRatioParts[0] - techRatioParts[1]); a.tech[1] += wgt;
  a.numbers[0] += wgt * Math.log(Math.max(1e-9, startHeads[0]) / Math.max(1e-9, startHeads[1])); a.numbers[1] += wgt;
  a.personnel[0] += wgt * Math.log(Math.max(1, startPers[0]) / Math.max(1, startPers[1])); a.personnel[1] += wgt;
  a.power[0] += wgt * Math.log(Math.max(1e-12, startP[0]) / Math.max(1e-12, startP[1])); a.power[1] += wgt;
  a.terrain[0] += wgt * (postureLog[0] - postureLog[1]); a.terrain[1] += wgt;
  a.command[0] += wgt * (cmdLog[0] - cmdLog[1]); a.command[1] += wgt;
  // air contribution relative to the best ground power of the day (the opening round can be all-air)
  const airLog = Math.log((1 + b.airPow[0] / Math.max(1e-9, groundMax[0])) / (1 + b.airPow[1] / Math.max(1e-9, groundMax[1])));
  a.air[0] += wgt * airLog; a.air[1] += wgt;
  a.battleLoss[0] += b.casualties[0]; a.battleLoss[1] += b.casualties[1];
  const tot = b.casualties[0] + b.casualties[1];
  st.battlesToday.push({ lat: +g.lat[cell].toFixed(3), lon: +g.lon[cell].toFixed(3), intensity: clamp(Math.log10(1 + tot) / 5, 0.05, 1) });
  // why: the dominant modifiers, from the winner's point of view
  if (b.winner < 0) return '';
  const w = b.winner, sign = w === 0 ? 1 : -1;
  const items: [string, number][] = [
    ['lethality per soldier (tech, armor, dispersion)', sign * (techRatioParts[0] - techRatioParts[1])],
    ['numbers', sign * (EXPLAIN_LOCAL_POWER
      ? Math.log(Math.max(1, startPers[0]) / Math.max(1, startPers[1]))
      : Math.log(Math.max(1e-9, startHeads[0]) / Math.max(1e-9, startHeads[1])))],
    ['terrain, posture and fortification', sign * (postureLog[0] - postureLog[1])],
    ['command and combined arms', sign * (cmdLog[0] - cmdLog[1])],
    ['air support', sign * airLog],
  ];
  items.sort((x, y) => y[1] - x[1]);
  const top = items.filter((x) => x[1] > 0.05).slice(0, 2);
  if (!top.length) return 'Evenly matched; decided by morale and chance.';
  return 'Winner\'s edge: ' + top.map(([k, v]) => `${k} x${Math.exp(v) >= 100 ? Math.exp(v).toExponential(1) : Math.exp(v).toFixed(1)}`).join(', ') + '.';
}

/** Beaten formation f gives up the contested cell: one cell toward own supply, else it surrenders. */
function leaveCell(ctx: Ctx, f: number, cell: number, b: Battle): void {
  const { S, st, sc } = ctx;
  const F = st.F, g = S.grid;
  const side = F.side[f], enemy = 1 - side;
  const sd = st.supplyDist[side];
  let best = -1, bv = Infinity;
  for (let d = 0; d < 8; d++) {
    const j = g.nb[cell * 8 + d];
    if (j < 0 || !g.land[j] || sc.occ[enemy][j] > 0 || st.control[j] === enemy) continue;
    const v = sd[j] + (st.control[j] === side ? 0 : 1e-3);   // finite supply distance first, own ground on ties
    if (best < 0 || v < bv) { best = j; bv = v; }
  }
  if (best < 0) {
    const before = F.personnel[f];
    // the pocket is destroyed: encircledSurrenderShare (era of the formation) surrenders, the rest die
    const share = SURRENDER_SHARE_FROM_MODEL_RULES ? clamp(rule(S.m.modelRules.surrender.encircledSurrenderShare, S.members[F.member[f]].ruleYear), 0, 1) : 1;
    if (share < 1) lossFraction(ctx, f, 1 - share, LC.combat);
    lossFraction(ctx, f, 1, LC.captured);
    b.casualties[side] += before - F.personnel[f];
    return;
  }
  sc.occ[side][cell]--;
  sc.occ[side][best]++;
  F.cell[f] = best;
}

function maxRate(ctx: Ctx, list: number[]): number {
  const F = ctx.st.F;
  let best = 0;
  for (const f of list) {
    const mr = ctx.S.members[F.member[f]];
    const o = f * NR;
    for (let r = 0; r < NR; r++) if (F.counts[o + r] >= 0.5 && mr.rate[r] > best) best = mr.rate[r];
  }
  return best;
}

// ---------------------------------------------------------------- sieges

/** Attacking formations next to an empty enemy fortified place besiege it (ENGINE.md 12). */
export function siegePhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  const F = st.F;
  const progressed = new Set<number>();
  const best = new Map<number, [number, number]>();
  for (let f = 0; f < F.n; f++) {
    if (!F.alive[f] || !F.onMap[f] || F.fought[f] || F.mode[f] !== Mode.Attack) continue;
    const t = F.next[f];
    const side = F.side[f] as 0 | 1;
    if (t < 0 || sc.occ[1 - side][t] > 0 || !isProtectedEnemyPlace(ctx, side, t)) continue;
    const mr = S.members[F.member[f]];
    const pl = S.places[S.placeAt[t]];
    const ownerFort = S.members[pl.member].tech.fortification;
    const days = Math.max(0.05, matrix(S.m.siege.daysToReduce, mr.tech.weapons, ownerFort));
    const rate = (1 / days) * (mr.specials.has('siege_engineering') ? S.specialEffect('siegeEngineering') : 1);
    const cur = best.get(t);
    if (!cur || rate > cur[0]) best.set(t, [rate, side]);
    F.status[f] = UnitStatus.Besieging;
  }
  for (const [cell, [rate, side]] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
    if (progressed.has(cell)) continue;
    progressed.add(cell);
    const was = st.siege[cell];
    st.siege[cell] = Math.min(1, was + rate);
    if (was === 0) addEvent(ctx, side as 0 | 1, 'siege', `${S.sideNames[side]} besieged ${S.places[S.placeAt[cell]].name}.`, undefined, cell);
    st.lastActivityDay = st.day;
  }
  void byTech; void IS_P;
}
