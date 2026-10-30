// Honest-limits page. Initial text by the frontend; the orchestrator replaces
// the section bodies with the final validated content (VALIDATION.md, COVERAGE.md).
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
          <h3>Weakest data</h3>
          <ul>
            <li>Ancient and early medieval army sizes. Chroniclers' figures are unreliable; modern estimates often span a factor of two or more (grade C or D).</li>
            <li>Ratings such as training, cohesion, morale and command quality. They come from a written rubric, not from measurement.</li>
            <li>Pre-1820 economic output (Maddison estimates before 1000 CE are reconstructions) and anything about pre-modern logistics capacity.</li>
            <li>Modern equipment readiness: inventories are public, how much of it works is not.</li>
            <li>Historical borders are approximate polygons from an open dataset and are drawn as such.</li>
            <li>The terrain grid is 0.25 degrees (about 25 km). Battles hinge on features far smaller than one cell.</li>
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
