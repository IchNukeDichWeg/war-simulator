// Naval war (ENGINE.md section 6): one theater fleet per side, one daily
// engagement when both sortie. The loss rule reuses the ground casualty model
// (combat.baseDailyCasualtyRate and powerRatioExponent at ships tech): the
// mechanics contract has no separate naval attrition rate yet.
import type { Ctx } from './ctx';
import { addEvent, seasonIdx } from './ctx';
import { byTech, clamp } from './mech';
import { NAVAL_ROLES, ROLES } from './roles';
import { BATTLE_ROUND_LOSS_CAP, BLOCKADE_SEA_CONTROL } from './constants';
import { SEASONS } from './setup';

export function fleetPower(ctx: Ctx, side: 0 | 1): number {
  const { S, st } = ctx;
  const pt = S.poolTech[side];
  let p = 0;
  for (const r of NAVAL_ROLES) {
    const c = st.fleet[side][r];
    if (c <= 0) continue;
    p += c * byTech(S.m.lethality.tli[ROLES[r]], pt.ships) * pt.q[r] * pt.t[r];
  }
  return p * pt.cmd;
}

/** True when the enemy fleet blockades `side` (sea moves and sea supply blocked). */
export function blockaded(ctx: Ctx, side: 0 | 1): boolean {
  const { S, st } = ctx;
  if (!S.scenario.rules.naval) return false;
  return st.seaControl[1 - side] > BLOCKADE_SEA_CONTROL && fleetPower(ctx, (1 - side) as 0 | 1) > 0;
}

/** Multiplier on sea-borne supply for `side`. */
export function seaFactor(ctx: Ctx, side: 0 | 1): number {
  const { S, st } = ctx;
  if (!S.scenario.rules.naval) return 1;
  // ENGINE.md 6: sea supply throughput x sea control; uncontested (no fleets anywhere) = full
  let f = fleetPower(ctx, 0) + fleetPower(ctx, 1) > 0 ? clamp(st.seaControl[side], 0, 1) : 1;
  if (blockaded(ctx, side)) f *= 1 - S.m.naval.blockadeInterdiction.mid;
  return f;
}

export function navalPhase(ctx: Ctx): void {
  const { S, st, rng } = ctx;
  if (!S.scenario.rules.naval) { st.seaControl = [0.5, 0.5]; return; }
  let p0 = fleetPower(ctx, 0), p1 = fleetPower(ctx, 1);
  const season = SEASONS[seasonIdx(ctx)];
  let hasSea = false;
  for (let i = 0; i < S.grid.n; i++) if (!S.grid.land[i]) { hasSea = true; break; }
  if (p0 > 0 && p1 > 0 && hasSea) {
    const sortie = [0, 1].map((s) => rng.next() >= S.m.naval.weatherDenial[S.poolTech[s].propulsion][season].mid);
    if (sortie[0] && sortie[1]) {
      const R = p0 / p1;
      const loss = [0, 1].map((s) => {
        const t = S.poolTech[s].ships;
        const base = byTech(S.m.combat.baseDailyCasualtyRate, t);
        const alpha = byTech(S.m.combat.powerRatioExponent, t);
        return Math.min(BATTLE_ROUND_LOSS_CAP, base * Math.pow(s === 0 ? R : 1 / R, -alpha));
      });
      let lostShips = [0, 0];
      for (const s of [0, 1] as const) for (const r of NAVAL_ROLES) {
        const l = st.fleet[s][r] * loss[s];
        st.fleet[s][r] -= l;
        st.platformLosses[s] += l;
        lostShips[s] += l;
      }
      if (lostShips[0] + lostShips[1] >= 1 && (st.day % 30 === 1 || st.acc.seaDays === 0)) {
        const w = lostShips[0] < lostShips[1] ? 0 : 1;
        addEvent(ctx, w as 0 | 1, 'naval', `Fleet action: ${S.sideNames[0]} lost ${lostShips[0].toFixed(1)} ships, ${S.sideNames[1]} ${lostShips[1].toFixed(1)}.`,
          `Fleet power ratio ${(p0 / p1).toFixed(2)}:1.`);
      }
      p0 = fleetPower(ctx, 0); p1 = fleetPower(ctx, 1);
      st.lastActivityDay = st.day;
    }
  }
  const tot = p0 + p1;
  st.seaControl = tot > 0 ? [p0 / tot, p1 / tot] : [0.5, 0.5];
  if (tot > 0) { st.acc.seaControlSum += st.seaControl[0]; st.acc.seaDays++; }
}
