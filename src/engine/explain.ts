// Result explanation (ENGINE.md section 12): compare the sides on accumulated
// factors and rank them. Each factor is a signed log-ratio (positive favours
// side 0); weights are the shares of the absolute values. The scales are
// presentation choices, not model physics.
import { HOSPITAL_ADMISSIONS_RETURN } from './constants';
import type { Ctx } from './ctx';
import type { Reason } from './protocol';
import { sideNow } from './victory';

export function explain(ctx: Ctx): Reason[] {
  const { S, st } = ctx;
  const a = st.acc;
  const names = S.sideNames;
  const items: { factor: string; v: number; detail: (fav: 0 | 1) => string }[] = [];
  const mean = (p: [number, number]) => (p[1] > 0 ? p[0] / p[1] : 0);
  const x = (v: number) => { const e = Math.exp(Math.abs(v)); return e >= 1000 ? e.toExponential(1) : e.toFixed(e >= 10 ? 0 : 1); };
  if (a.battles > 0) {
    const t = mean(a.tech);
    items.push({ factor: 'Tech gap', v: t, detail: (f) => `${names[f]} formations were x${x(t)} as lethal per soldier in battle (TLI over enemy dispersion, armor matrix, ISR/EW/cyber/precision gaps), averaged over ${a.battles} battle-days.` });
    const c = mean(a.command);
    items.push({ factor: 'Command and doctrine', v: c, detail: (f) => `${names[f]} had x${x(c)} from command quality and combined arms.` });
    const tr = mean(a.terrain);
    items.push({ factor: 'Terrain and fortification', v: tr, detail: (f) => `${names[f]} drew x${x(tr)} from terrain, prepared defence, fortification, home ground and doctrine specials.` });
    const air = mean(a.air);
    if (Math.abs(air) > 1e-6) items.push({ factor: 'Air support', v: air, detail: (f) => `${names[f]} gained x${x(air)} combat power from air support in battle.` });
  }
  // fielded = start + new arrivals (returns to duty are the same people coming back)
  const back = (s: 0 | 1) => (HOSPITAL_ADMISSIONS_RETURN ? 0 : st.returned[s]);
  const n0 = st.startPersonnel[0] + st.arrivals[0] - back(0), n1 = st.startPersonnel[1] + st.arrivals[1] - back(1);
  const w0 = st.startW[0] + st.addedW[0], w1 = st.startW[1] + st.addedW[1];
  const num = a.battles > 0 ? mean(a.numbers) : Math.log(Math.max(1, n0) / Math.max(1, n1));
  items.push({ factor: 'Numbers', v: num, detail: (f) => `${names[f]} fielded ${Math.round(f === 0 ? n0 : n1).toLocaleString('en-US')} personnel vs ${Math.round(f === 0 ? n1 : n0).toLocaleString('en-US')}${a.battles > 0 ? `, and on average x${x(num)} more strength (personnel + platforms) at the point of battle` : ''}.` });
  const sf0 = a.formationDays[0] ? a.shortfallDays[0] / a.formationDays[0] : 0;
  const sf1 = a.formationDays[1] ? a.shortfallDays[1] / a.formationDays[1] : 0;
  const starve0 = st.losses[0][4], starve1 = st.losses[1][4];
  if (sf0 + sf1 > 0.01) items.push({ factor: 'Supply', v: 2 * (sf1 - sf0), detail: (f) => `${names[1 - f]} averaged ${Math.round((f === 0 ? sf1 : sf0) * 100)}% supply shortfall (vs ${Math.round((f === 0 ? sf0 : sf1) * 100)}%) and lost ${Math.round(f === 0 ? starve1 : starve0).toLocaleString('en-US')} to starvation.` });
  if (a.seaDays > 0) {
    const sc = a.seaControlSum / a.seaDays;
    items.push({ factor: 'Naval control', v: 2 * (sc - 0.5), detail: (f) => `${names[f]} held ${Math.round((f === 0 ? sc : 1 - sc) * 100)}% sea control on average${st.seaControl[1 - f] > 0.6 ? '' : ''}.` });
  }
  if (a.airDays > 0) {
    const as = a.airSupSum / a.airDays;
    items.push({ factor: 'Air superiority', v: as, detail: (f) => `${names[f]} averaged ${Math.round(Math.abs(as) * 100)} points more air superiority.` });
  }
  if (a.routs[0] + a.routs[1] > 0) {
    const v = Math.log((1 + a.routs[1]) / (1 + a.routs[0]));
    items.push({ factor: 'Morale collapses', v, detail: (f) => `${names[1 - f]} had ${f === 0 ? a.routs[1] : a.routs[0]} formation routs vs ${f === 0 ? a.routs[0] : a.routs[1]}.` });
  }
  const nb0 = a.nonBattle[0], nb1 = a.nonBattle[1];
  if (nb0 + nb1 > 0) {
    const f0 = nb0 / Math.max(1, n0), f1 = nb1 / Math.max(1, n1);
    items.push({ factor: 'Disease and attrition', v: 2 * (f1 - f0), detail: (f) => `${names[1 - f]} suffered non-battle losses (disease, exposure, starvation, desertion; part return to duty) equal to ${Math.round((f === 0 ? f1 : f0) * 100)}% of the personnel it fielded (vs ${Math.round((f === 0 ? f0 : f1) * 100)}%).` });
  }
  void w0; void w1; void sideNow;
  const tot = items.reduce((s, i) => s + Math.abs(i.v), 0);
  if (tot <= 0) return [{ factor: 'No decisive factor', side: 0, weight: 1, detail: 'The sides never fought and no factor separated them.' }];
  return items
    .filter((i) => Math.abs(i.v) / tot >= 0.01)
    .map((i) => {
      const fav: 0 | 1 = i.v >= 0 ? 0 : 1;
      return { factor: i.factor, side: fav, weight: +(Math.abs(i.v) / tot).toFixed(3), detail: i.detail(fav) };
    })
    .sort((p, q) => q.weight - p.weight);
}
