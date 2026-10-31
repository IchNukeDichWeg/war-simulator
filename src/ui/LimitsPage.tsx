// Honest-limits page. The section bodies summarise VALIDATION.md (backtest, QA, red team),
// COVERAGE.md and the known limits in data/SOURCES.md; keep them in step with those files.
import { GradeBadge } from './Grade';
import { store, useStore } from './store';

export function LimitsPage() {
  const data = useStore((s) => s.data);
  const counts = { A: 0, B: 0, C: 0, D: 0 } as Record<'A' | 'B' | 'C' | 'D', number>;
  if (data) {
    const walk = (o: unknown) => {
      if (!o || typeof o !== 'object') return;
      if ('grade' in o && 'mid' in o) { const g = (o as { grade: 'A' | 'B' | 'C' | 'D' }).grade; if (g in counts) counts[g]++; return; }
      for (const v of Object.values(o)) walk(v);
    };
    data.snapshots.forEach(walk);
  }
  const total = counts.A + counts.B + counts.C + counts.D;

  return (
    <div className="limits-overlay" onClick={(e) => { if (e.target === e.currentTarget) store.set({ showLimits: false }); }}>
      <article className="limits">
        <button className="close" onClick={() => store.set({ showLimits: false })}>Close</button>
        <h2>Honest limits</h2>
        <p className="lead">This app is a model. It produces scenarios under stated assumptions, not predictions of what would happen. Every number carries a confidence grade, and the results inherit the weakest of them.</p>

        <section>
          <h3>Confidence grades in the loaded data</h3>
          {total === 0 ? <p className="muted">No snapshot data is loaded in this build, so there is nothing to grade yet.</p> : (
            <div className="grade-dist">
              {(['A', 'B', 'C', 'D'] as const).map((g) => (
                <div key={g}><GradeBadge g={g} /> {counts[g].toLocaleString('en-US')} values ({((100 * counts[g]) / total).toFixed(1)}%)</div>
              ))}
            </div>
          )}
          {data && data.phase3.length > 0 && <p className="small">{data.phase3.length.toLocaleString('en-US')} more snapshots are <b>Phase 3 derived</b>: not researched, every value a formula over the polity's border polygon and regional inputs, overall confidence {[...new Set(data.phase3.map((e) => e.confidence))].sort().join('/')}. Their values count above only once their era is loaded (on first use).</p>}
          <p className="small"><GradeBadge g="A" /> documented or officially reported. <GradeBadge g="B" /> scholarly estimate with a range. <GradeBadge g="C" /> reconstructed from analogies or indirect evidence. <GradeBadge g="D" /> educated guess, flagged as such. <GradeBadge g="M" /> model output: computed by the simulation, not sourced.</p>
        </section>

        <section>
          <h3>What the model can say</h3>
          <ul>
            <li>How the stated inputs interact: which side's logistics, technology, numbers, terrain or doctrine dominate under the rules you chose, and why (the ranked reasons after every run).</li>
            <li>Which inputs matter most: edit any value inside its researched low-high range and rerun, or use Monte Carlo to see how often an outcome repeats.</li>
            <li>Order-of-magnitude contrasts across eras, such as why a pre-gunpowder army cannot close with modern firepower, using one published lethality framework (Dupuy) for every era.</li>
          </ul>
        </section>

        <section>
          <h3>What it cannot say</h3>
          <ul>
            <li>What would actually happen. Real wars turn on politics, leadership decisions, alliances shifting, and chance events that no parameter set captures.</li>
            <li>Precise casualty counts or dates. Treat outputs as ranges and directions, not figures to quote.</li>
            <li>Anything about diplomacy, occupation, insurgency or the war after the war. The run ends when a victory condition fires.</li>
            <li>Nuclear outcomes beyond a crude, documented escalation model. That rule is off by default for this reason.</li>
            <li>Cross-era matchups as history. Rome against a 2026 state is a thought experiment with explicit rules (native, equalized, time-slice), not a question with a true answer.</li>
          </ul>
        </section>

        <section>
          <h3>How it scores against history</h3>
          <p>24 historical battles from Marathon to Iraq 2003 are rerun over 20 seeds each (VALIDATION.md). The model picks the historical winner in 19 of 24, gets the loss ratio within a factor of 3 in 15 and the duration within a factor of 3 in 22. The pass mark set before building was 18 winners that hold up when any single grade-D constant moves across its range. The last screen, 200 seeds before the era clamp was added, found 17, and it has not been rerun, so <b>the validation gate is not met</b>.</p>
          <ul>
            <li>Marathon: the Athenians are out-powered in the model and lose. Adrianople reaches 65% over 20 seeds but 43.5% over 200, so it is not a pass; the Gothic cavalry arriving on the flank mid-battle is not modelled.</li>
            <li>Carrhae and Mohi: the winners broke contact and harassed. A break-contact rule was built and rejected: it left Carrhae lost, since horse-archer standoff is not modelled, and won Mohi for the wrong reason.</li>
            <li>Six-Day War: no pre-emptive air strike, so the Arab air forces survive day one.</li>
            <li>Yom Kippur (Sinai): no crossing at the seam between two armies, so the counter-crossing never happens.</li>
            <li>Loss ratios are the weakest output: 9 of 24 are off by more than a factor of 3.</li>
            <li>Before the era clamp, France 1940 was the one winner that failed on a single grade-D constant at 200 seeds per battle: starvation at its high, or WWII air strike lethality at its low. Hastings still runs out of time at the high era breakpoint. Applying every researched replacement for the guessed values, including ones still graded D, takes Blenheim and France below the winner line.</li>
          </ul>
        </section>

        <section>
          <h3>Known model gaps</h3>
          <ul>
            <li>Nuclear use fires only on lost home territory or a besieged capital. There is no deterrence: nuclear powers invade each other freely, and a collapsing nuclear-armed army does not escalate.</li>
            <li>Neutral territory is transparent. Armies march across third countries without transit rights.</li>
            <li>Time-slice mode currently gives the same engine result as native mode.</li>
            <li>Wars between powers separated by an ocean (USA vs China 2026, Japan vs USA 1941) end as draws on the time limit in every tested seed.</li>
            <li>Supply at the end of a long line can fall to zero, and modern formations without ammunition and fuel inflict almost nothing: the USA needs about 100 days and thousands of casualties to take the Vatican's 135 guards.</li>
            <li>The defending AI can leave its capital empty against a seaborne landing, which then falls to a siege without a battle.</li>
            <li>The ranked reasons list the winner's advantages first, so the top line can be a small factor while a larger one favoured the loser. Read the percentages, not the order.</li>
            <li>Scrubbing far back in a very long run replays up to 960 days, which can take several seconds.</li>
          </ul>
        </section>

        <section>
          <h3>Weakest data</h3>
          <ul>
            <li>Ancient and early medieval army sizes. Chroniclers' figures are unreliable; modern estimates often span a factor of two or more (grade C or D).</li>
            <li>Ratings such as training, cohesion, morale and command quality. They come from a written rubric, not from measurement.</li>
            <li>Pre-1820 economic output (Maddison estimates before 1000 CE are reconstructions) and anything about pre-modern logistics capacity.</li>
            <li>Modern equipment readiness: inventories are public, how much of it works is not.</li>
            <li>Historical borders are approximate polygons from an open dataset and are drawn as such.</li>
            <li>The terrain grid is 0.25 degrees (about 25 km). Battles hinge on features far smaller than one cell.</li>
            <li>Phase 3 derived snapshots (about 900 polities, labelled in every list) are formulas, not research. Population comes from a modern country's series where the borders match, else from regional density, which leaves some deserts far too populous (the 1945 Libyan provinces, Western Sahara, Arabia 1878) and lets a union that matches one member drop the rest (Denmark-Norway). Horses are absent only before contact; when each people adopted them later is not modelled, and forest-zone African cavalry comes from regional peers.</li>
            <li>Generated 2026 snapshots of states without research (marked auto-base) take force mix and ratings from regional medians at grade D. Several microstates are recorded with no armed forces and fall without a fight.</li>
            <li>Some editable values (GDP, urbanization, ports and others) are not used by the engine; the editor marks them.</li>
          </ul>
        </section>

        <section>
          <h3>Scenarios, not forecasts</h3>
          <p>A run is deterministic for a given seed and data version, so results are reproducible and shareable, but reproducible is not the same as right. The engine has been backtested against historical battles; where it disagrees with history, that is reported in VALIDATION.md rather than tuned away. Use the results to ask better questions, not to settle them.</p>
        </section>
      </article>
    </div>
  );
}
