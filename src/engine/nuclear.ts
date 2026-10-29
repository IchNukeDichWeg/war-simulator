// Nuclear escalation (ENGINE.md section 11). Off unless rules.nuclear. A
// deliberately simple ladder: first use only after losing more than
// escalationThreshold of own starting theater territory or with the capital
// under siege, aimed at the largest enemy concentration; retaliation by a
// nuclear-armed enemy targets cities. One warhead per strike.
import type { Ctx } from './ctx';
import { addEvent } from './ctx';
import { LC } from './roles';
import { NUCLEAR_COOLDOWN_DAYS } from './constants';
import { lossFraction } from './formations';

export function nuclearPhase(ctx: Ctx): void {
  const { S, st, sc } = ctx;
  if (!S.scenario.rules.nuclear) return;
  const F = st.F;
  const g = S.grid;
  for (const s of [0, 1] as const) {
    const o = (1 - s) as 0 | 1;
    const enemyUsed = S.sideMembers[o].some((mi) => st.members[mi].lastNukeDay >= 0);
    for (const mi of S.sideMembers[s]) {
      const mr = S.members[mi];
      const ms = st.members[mi];
      if (ms.warheads < 1 || (ms.lastNukeDay >= 0 && st.day - ms.lastNukeDay < NUCLEAR_COOLDOWN_DAYS)) continue;
      let trigger = '';
      if (enemyUsed) trigger = 'retaliation for enemy nuclear use';
      else {
        if (mr.startCells > 0) {
          let lost = 0;
          for (let c = 0; c < g.n; c++) if (S.owner0[c] === mi && st.control[c] === o) lost++;
          const share = lost / mr.startCells;
          if (share > S.m.nuclear.escalationThreshold.mid) trigger = `lost ${Math.round(share * 100)}% of its starting territory (threshold ${Math.round(S.m.nuclear.escalationThreshold.mid * 100)}%)`;
        }
        if (!trigger && mr.capitalCell >= 0) {
          const c = mr.capitalCell;
          let besieged = sc.occ[o][c] > 0;
          for (let d = 0; d < 8 && !besieged; d++) { const j = g.nb[c * 8 + d]; if (j >= 0 && sc.occ[o][j] > 0) besieged = true; }
          if (besieged) trigger = 'capital under siege';
        }
      }
      if (!trigger) continue;
      let target = -1;
      let lossK = 0;
      let what = '';
      if (enemyUsed) {
        let bestPop = -1;
        for (const p of S.places) {
          if (p.side !== o || st.control[p.cell] !== o) continue;
          const v = (p.capital ? 1e12 : 0) + p.pop;
          if (v > bestPop) { bestPop = v; target = p.cell; what = p.name; }
        }
        lossK = S.m.nuclear.cityLoss.mid;
        if (target >= 0) {
          const pl = S.places[S.placeAt[target]];
          const owner = S.members[pl.member];
          const pop = owner.snap.demography?.population?.mid ?? 0;
          if (pl.pop > 0 && pop > 0) st.members[owner.idx].productionDamage *= 1 - lossK * Math.min(1, pl.pop / pop);
        }
      }
      if (target < 0) {
        const pow = sc.tmpN;
        pow.fill(0);
        for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === o) pow[F.cell[f]] += F.curW[f];
        let bv = 0;
        for (let c = 0; c < g.n; c++) if (pow[c] > bv) { bv = pow[c]; target = c; }
        lossK = S.m.nuclear.formationLoss.mid;
        what = 'the largest enemy troop concentration';
      }
      if (target < 0) continue;
      let killed = 0;
      for (let f = 0; f < F.n; f++) if (F.alive[f] && F.onMap[f] && F.side[f] === o && F.cell[f] === target) killed += lossFraction(ctx, f, lossK, LC.nuclear);
      ms.warheads -= 1;
      ms.lastNukeDay = st.day;
      st.lastActivityDay = st.day;
      addEvent(ctx, s, 'nuclear', `${mr.name} used a nuclear weapon on ${what}; ${Math.round(killed).toLocaleString('en-US')} troops lost.`, `Trigger: ${trigger}.`, target);
    }
  }
}
