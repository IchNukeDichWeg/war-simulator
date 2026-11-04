// Monte Carlo tab: runs the scenario many times and leads with one plain sentence (who wins how
// often, with the sampling margin), a split bar and the typical war length and losses. The full
// breakdown (win probability with its interval, war length histogram, loss ranges, how the runs
// ended, deciding factors) sits behind a Details disclosure. Everything shown is computed from
// the worker's MonteCarloResult (protocol unchanged); the intervals and histogram are UI-side
// summaries of the per-run results.
import { useEffect, useId, useMemo, useState } from 'react';
import type { MonteCarloResult } from '../../engine/protocol';
import { cancelMonteCarlo, mcScenario, mcStartedAt, runMonteCarlo, scenarioProblems } from '../engine';
import { fmtCount, fmtDays } from '../format';
import { endReasonBreakdown, histogram, outcomeCounts, wilson } from '../runStats';
import { store, useStore } from '../store';
import { useLegibleColors } from './Charts';
import { ModelTag, Reasons, useSides } from './RunShared';
import '../../styles/montecarlo.css';

// 100 matches the setup panel's default; 1000 resolves a win chance to about +/-3 pts.
const RUN_PRESETS = [100, 500, 1000];
const DRAW_COLOR = 'var(--muted, #8b949e)';
const pct1 = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;

/** Half-width of the 95% Wilson interval at a 50% outcome, the widest case: what N runs can resolve. */
const precisionAt = (n: number) => { const w = wilson(n / 2, n); return (w.hi - w.lo) / 2; };

/** "73%, +/- 9" when the 95% Wilson interval is close to symmetric, else "98%, likely 93% to 100%"
 *  (near 0% or 100% the interval is lopsided and a single +/- would overshoot the bounds). */
function margin(k: number, n: number): string {
  const w = wilson(k, n);
  const p = Math.round(w.p * 100), lo = Math.round(w.lo * 100), hi = Math.round(w.hi * 100);
  return Math.abs((hi - p) - (p - lo)) <= 1 ? `${p}%, +/- ${Math.round((hi - lo) / 2)}` : `${p}%, likely ${lo}% to ${hi}%`;
}

function Progress({ done, total }: { done: number; total: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 500); return () => clearInterval(t); }, []);
  const elapsed = (now - mcStartedAt) / 1000;
  const rate = done > 0 && elapsed > 0 ? done / elapsed : 0;
  const eta = rate > 0 ? (total - done) / rate : null;
  const f = (s: number) => (s >= 90 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
  const pct = Math.round((100 * done) / Math.max(1, total));
  return (
    <div className="rp-mc-progress">
      <div className="progress" role="progressbar" aria-label="Monte Carlo runs finished" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} runs (${pct}%)`}>
        <div style={{ width: `${(100 * done) / Math.max(1, total)}%` }} /><span>{done} / {total} runs ({pct}%)</span>
      </div>
      <div className="rp-muted small">{f(elapsed)} elapsed{rate > 0 ? `, ${rate.toFixed(rate < 10 ? 1 : 0)} runs/s` : ''}{eta != null ? `, about ${f(eta)} left` : ''}</div>
    </div>
  );
}

/** The plain-language lead: who wins how many runs, the sampling margin, and a split bar. */
function Headline({ r, names, colors }: { r: MonteCarloResult; names: [string, string]; colors: [string, string] }) {
  const counts = outcomeCounts(r);
  const order = ([0, 1, 2] as const).slice().sort((a, b) => counts[b] - counts[a]);
  const [lead, second] = order;
  const tie = counts[lead] === counts[second];
  const label = (i: 0 | 1 | 2) => (i === 2 ? 'Draw' : names[i]);
  const color = (i: 0 | 1 | 2) => (i === 2 ? DRAW_COLOR : colors[i]);
  const outcome = (i: 0 | 1 | 2) => (i === 2
    ? <>{counts[2]} end in a <span style={{ color: DRAW_COLOR }}>draw</span></>
    : <><span style={{ color: colors[i] }}>{names[i]}</span> wins {counts[i]}</>);
  // draw in the middle so each side's share grows from its own end
  const segs = ([0, 2, 1] as const).map((i) => ({ i, k: counts[i], p: r.runs > 0 ? counts[i] / r.runs : 0 }));
  return (
    <div className="rp-mc-head">
      <div className="rp-mc-kicker"><span>Out of {r.runs} runs</span><ModelTag /></div>
      <div className="rp-mc-lead">
        {tie
          ? <>Too close to call: {outcome(lead)} and {outcome(second)} of {r.runs} runs</>
          : lead === 2
            ? <>Most runs end in a <span style={{ color: DRAW_COLOR }}>draw</span>: {counts[2]} of {r.runs}</>
            : <><span style={{ color: colors[lead] }}>{names[lead]}</span> wins {counts[lead]} of {r.runs} runs</>}
        {!tie && <span className="rp-mc-margin"> ({margin(counts[lead], r.runs)})</span>}
      </div>
      <div className="rp-mc-split" role="img" aria-label={segs.map((s) => `${label(s.i)} ${pct1(s.p)}`).join(', ')}>
        {segs.map((s) => s.k > 0 && <div key={s.i} style={{ width: `${s.p * 100}%`, background: color(s.i) }} title={`${label(s.i)}: ${s.k} of ${r.runs} runs`} />)}
      </div>
      <div className="rp-mc-legend" aria-hidden>
        {segs.map((s) => (
          <span key={s.i} className={s.i === 1 ? 'end' : s.i === 2 ? 'mid' : ''}>
            <i style={{ background: color(s.i) }} />{label(s.i)} <b>{pct1(s.p)}</b>
          </span>
        ))}
      </div>
      {!tie && <div className="rp-muted small">The +/- is how far that share could move just from running only {r.runs} wars (95% range).</div>}
    </div>
  );
}

/** Typical war length, typical losses, the most common ending and the factor that most often decided it. */
function KeyFacts({ r, names, colors }: { r: MonteCarloResult; names: [string, string]; colors: [string, string] }) {
  const ending = useMemo(() => endReasonBreakdown(r.results, 1)[0], [r]);
  const factor = r.topReasons[0];
  return (
    <dl className="rp-mc-facts">
      <div>
        <dt>Typical length</dt>
        <dd><b>{fmtDays(r.endDay.p50)}</b><span className="rp-muted small">8 in 10 runs: day {Math.round(r.endDay.p10)} to {Math.round(r.endDay.p90)}</span></dd>
      </div>
      <div>
        <dt>Typical losses</dt>
        <dd>
          {([0, 1] as const).map((s) => (
            <span key={s} className="rp-mc-loss"><span style={{ color: colors[s] }}>{names[s]}</span> <b>{fmtCount(r.casualties[s].p50)}</b></span>
          ))}
        </dd>
      </div>
      {ending && (
        <div className="wide">
          <dt>Most common ending</dt>
          <dd>
            <span><span style={{ color: ending.winner === 'draw' ? undefined : colors[ending.winner] }}>{ending.winner === 'draw' ? 'Draw' : `${names[ending.winner]} won`}</span>: {ending.reason}</span>
            <span className="rp-muted small">{pct1(ending.count / Math.max(1, r.results.length))} of runs</span>
          </dd>
        </div>
      )}
      {factor && (
        <div className="wide">
          <dt>Most often decided by</dt>
          <dd>
            <span><b>{factor.factor}</b>, in favour of <span style={{ color: colors[factor.side] }}>{names[factor.side]}</span></span>
            <span className="rp-muted small">ranked first in {Math.round(factor.weight * 100)}% of runs</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

function WinProbability({ r, names, colors }: { r: MonteCarloResult; names: [string, string]; colors: [string, string] }) {
  const counts = outcomeCounts(r);
  const rows = ([0, 1, 2] as const).map((i) => ({ i, label: i === 2 ? 'Draw' : names[i], color: i === 2 ? DRAW_COLOR : colors[i], k: counts[i], ...wilson(counts[i], r.runs) }));
  const lead = [...rows].sort((a, b) => b.p - a.p)[0];
  return (
    <div className="rp-wp">
      <div className="rp-wp-lead">
        <span style={{ color: lead.color }}>{lead.i === 2 ? 'Draw' : `${lead.label} wins`}</span> in <b>{pct1(lead.p)}</b> of runs
        <span className="rp-muted"> (95% interval {pct1(lead.lo)} to {pct1(lead.hi)})</span>
      </div>
      {rows.map((w) => (
        <div key={w.i} className="rp-wp-row" title={`${w.k} of ${r.runs} runs; 95% Wilson interval ${pct1(w.lo)} to ${pct1(w.hi)}`}>
          <span className="rp-wp-name">{w.label}</span>
          <div className="rp-wp-track">
            <div className="rp-wp-bar" style={{ width: `${w.p * 100}%`, background: w.color }} />
            <div className="rp-wp-ci" style={{ left: `${w.lo * 100}%`, width: `${Math.max(0.5, (w.hi - w.lo) * 100)}%` }} />
          </div>
          <span className="rp-wp-num"><b>{pct1(w.p)}</b><span className="rp-muted small"> {pct1(w.lo)}-{pct1(w.hi)}</span></span>
        </div>
      ))}
      <div className="rp-muted small">Bar: share of {r.runs} runs. Whisker: 95% Wilson interval, the uncertainty from running only {r.runs} seeds (about +/-{Math.round(precisionAt(r.runs) * 100)} pts at worst). It does not cover uncertainty in the model or the input data.</div>
    </div>
  );
}

/** p10-p90 range bar with the median tick, on an axis shared by the rows it is drawn with. */
function RangeRow({ label, color, p, max, f }: { label: string; color: string; p: { p10: number; p50: number; p90: number }; max: number; f: (v: number) => string }) {
  const x = (v: number) => `${Math.max(0, Math.min(100, (100 * v) / Math.max(1e-9, max)))}%`;
  return (
    <div className="rp-range">
      <div className="rp-range-head"><span>{label}</span><span className="rp-range-vals">{f(p.p10)} / <b>{f(p.p50)}</b> / {f(p.p90)}</span></div>
      <div className="rp-range-track" aria-hidden>
        <div className="rp-range-bar" style={{ left: x(p.p10), width: `calc(${x(p.p90)} - ${x(p.p10)})`, background: color }} />
        <div className="rp-range-mid" style={{ left: x(p.p50) }} />
      </div>
    </div>
  );
}

function Duration({ r }: { r: MonteCarloResult }) {
  const h = useMemo(() => histogram(r.results.map((x) => x.endDay), 14), [r]);
  const peak = Math.max(1, ...h.counts);
  const hiDay = h.lo + h.width * h.counts.length - 1;
  const span = h.width * h.counts.length;
  const at = (d: number) => `${Math.max(0, Math.min(100, (100 * (d - h.lo + 0.5)) / span))}%`;
  return (
    <div className="rp-mc-block">
      <div className="rp-range-head"><span>War length (days)</span><span className="rp-range-vals">p10 {Math.round(r.endDay.p10)} / <b>p50 {Math.round(r.endDay.p50)}</b> / p90 {Math.round(r.endDay.p90)}</span></div>
      {h.counts.length > 1 && (
        <div className="rp-hist" role="img" aria-label={`Histogram of war length over ${r.results.length} runs`}>
          <div className="rp-hist-y"><span>{peak}</span><span>runs</span><span>0</span></div>
          <div className="rp-hist-plot">
            <div className="rp-hist-bars">
              <div className="rp-hist-band" style={{ left: at(r.endDay.p10), width: `calc(${at(r.endDay.p90)} - ${at(r.endDay.p10)})` }} title="10th to 90th percentile" />
              <div className="rp-hist-med" style={{ left: at(r.endDay.p50) }} title={`Median: day ${Math.round(r.endDay.p50)}`} />
              {h.counts.map((c, i) => (
                <div key={i} className="rp-hist-bar" title={`${h.lo + i * h.width}-${h.lo + (i + 1) * h.width - 1} days: ${c} runs`}>
                  <div style={{ height: `${(100 * c) / peak}%` }} />
                </div>
              ))}
            </div>
            <div className="rp-hist-x"><span>day {h.lo}</span><span>war length (days)</span><span>day {hiDay}</span></div>
          </div>
        </div>
      )}
      <div className="rp-muted small">Median {fmtDays(r.endDay.p50)}; 8 in 10 runs ended between day {Math.round(r.endDay.p10)} and day {Math.round(r.endDay.p90)}.</div>
    </div>
  );
}

function EndReasons({ r, names, colors }: { r: MonteCarloResult; names: [string, string]; colors: [string, string] }) {
  const rows = useMemo(() => endReasonBreakdown(r.results, 5), [r]);
  if (rows.length === 0) return null;
  return (
    <table className="rp-endreasons">
      <tbody>
        {rows.map((e) => (
          <tr key={`${e.winner}|${e.reason}`}>
            <td className="rp-endreasons-n">{pct1(e.count / r.results.length)}</td>
            <td><span style={{ color: e.winner === 'draw' ? undefined : colors[e.winner] }}>{e.winner === 'draw' ? 'Draw' : `${names[e.winner]} won`}</span>: {e.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Run count choice and the start button (Cancel while a batch runs). */
function Controls({ runs, setRuns, running, hasResult }: { runs: number; setRuns: (n: number) => void; running: boolean; hasResult: boolean }) {
  const sc = useStore((s) => s.scenario);
  useStore((s) => s.data); // scenarioProblems reads the loaded snapshots
  const problems = scenarioProblems(sc);
  const probId = useId();
  if (running) return <div className="rp-mc-controls"><button onClick={cancelMonteCarlo}>Cancel</button></div>;
  return (
    <>
      <div className="rp-mc-controls">
        <span className="rp-mc-runs-label" id={`${probId}-n`}>Runs</span>
        <div className="seg" role="group" aria-labelledby={`${probId}-n`}>
          {RUN_PRESETS.map((n) => <button key={n} className={runs === n ? 'on' : ''} aria-pressed={runs === n} onClick={() => setRuns(n)}>{n}</button>)}
        </div>
        <button className="primary" disabled={problems.length > 0} aria-describedby={problems.length ? probId : undefined}
          onClick={() => runMonteCarlo(store.get().scenario, runs)}>{hasResult ? `Run again (${runs})` : `Run ${runs} times`}</button>
      </div>
      {problems.length > 0 && (
        <div className="notice warn" id={probId}>
          Fix the setup first: {problems.length === 1 ? problems[0] : <ul className="rp-mc-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
      <details className="rp-details rp-mc-opts">
        <summary>Run options</summary>
        <label>Custom number of runs <input className="narrow" type="number" min={2} max={5000} value={runs} onChange={(e) => setRuns(Math.max(2, Math.min(5000, Math.trunc(+e.target.value) || 2)))} /></label>
        <p className="small rp-muted">Runs the current scenario {runs} times with seeds {sc.seed}, {sc.seed + 1}, ... in a separate worker. {runs} runs pin a win probability to about +/-{Math.round(precisionAt(runs) * 100)} pts (95%); four times the runs halves that.</p>
      </details>
    </>
  );
}

export function MonteCarloView() {
  const mc = useStore((s) => s.mc);
  const sc = useStore((s) => s.scenario);
  const { names, colors: raw } = useSides();
  const colors = useLegibleColors(raw);
  const [runs, setRuns] = useState(RUN_PRESETS[0]);
  const r = mc.result;
  const running = mc.status === 'running';
  const stale = r != null && mcScenario != null && mcScenario !== sc;
  const casMax = r ? Math.max(1, r.casualties[0].p90, r.casualties[1].p90) : 1;
  return (
    <div className="panel-body">
      {!r && !running && (
        <div className="rp-mc-intro">
          <h4>Who usually wins?</h4>
          <p>Runs the same war many times with different random seeds to show how likely each outcome is. One run shows one possible war; a batch shows how often each outcome happens.</p>
        </div>
      )}
      {running && <h4>Running the war {mc.total} times...</h4>}
      {running && <Progress done={mc.done} total={mc.total} />}
      {mc.status === 'error' && <div className="notice warn">{mc.error}</div>}
      {r && (
        <>
          {stale && <div className="rp-note rp-note-warn">The scenario has changed since this batch ran. These numbers describe the earlier scenario; run again to update them.</div>}
          <Headline r={r} names={names} colors={colors} />
          <KeyFacts r={r} names={names} colors={colors} />
        </>
      )}
      <Controls runs={runs} setRuns={setRuns} running={running} hasResult={r != null} />
      {r && (
        <details className="rp-details rp-mc-details">
          <summary>Details: ranges, charts and all factors</summary>
          <h4>Win probability over {r.runs} runs <ModelTag /></h4>
          <WinProbability r={r} names={names} colors={colors} />
          <h4>How long the war lasted</h4>
          <Duration r={r} />
          <h4>Losses per side (p10 / p50 / p90)</h4>
          <div className="rp-mc-block">
            <RangeRow label={names[0]} color={colors[0]} p={r.casualties[0]} max={casMax} f={fmtCount} />
            <RangeRow label={names[1]} color={colors[1]} p={r.casualties[1]} max={casMax} f={fmtCount} />
            <div className="rp-muted small">Personnel lost: killed, wounded and captured plus disease, starvation, exposure and desertion. Bar: 10th to 90th percentile of runs; tick: median.</div>
          </div>
          <h4>How the runs ended</h4>
          <EndReasons r={r} names={names} colors={colors} />
          <h4>Factor ranked first most often</h4>
          <Reasons reasons={r.topReasons} names={names} colors={colors} top={3}
            weightTitle="Share of runs in which this factor was ranked first; the detail text is from one example run" weightNote="of runs" />
        </details>
      )}
      {r && <div className="rp-note">Spread reflects the model's randomness (seeds) only, not uncertainty in the input data. Edit values within their low-high range to probe that. Model output, not a prediction.</div>}
    </div>
  );
}
