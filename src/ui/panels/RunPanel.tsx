import { useEffect, useMemo, useState } from 'react';
import type { Reason, SideStats, SimEvent } from '../../engine/protocol';
import { flyBus } from '../bus';
import { cancelMonteCarlo, eventLog, history, runMonteCarlo } from '../engine';
import { fmt, fmtSpeed, pct, signed, signedPts } from '../format';
import { GradeBadge } from '../Grade';
import { deltaOver, EVENT_GROUPS, filterEvents, groupCounts, groupOf, share, type EventFilter, type EventGroup } from '../runStats';
import { store, useStore, type RightTab } from '../store';
import { SideChart, SideLegend, useLegibleColors } from './Charts';

function useSides() {
  const sc = useStore((s) => s.scenario);
  const runNames = useStore((s) => s.run.sideNames);
  const status = useStore((s) => s.run.status);
  const names: [string, string] = status === 'idle' ? [sc.sides[0].name, sc.sides[1].name] : runNames;
  const colors: [string, string] = [sc.sides[0].color, sc.sides[1].color];
  return { names, colors };
}

const ModelTag = () => <span className="model-tag" title="Simulation output, not sourced data">model output <GradeBadge g="M" /></span>;

function StatsTable({ stats }: { stats: [SideStats, SideStats] }) {
  const { names, colors } = useSides();
  const rows: [string, (s: SideStats) => string][] = [
    ['Personnel', (s) => fmt(s.personnel)],
    ['Platforms', (s) => fmt(s.platforms)],
    ['Casualties', (s) => fmt(s.casualties)],
    ['Supply', (s) => pct(s.supply)],
    ['Morale', (s) => pct(s.morale)],
    ['Territory', (s) => pct(s.territory)],
    ['Sea control', (s) => pct(s.seaControl)],
    ['Air superiority', (s) => pct(s.airSuperiority)],
  ];
  return (
    <table className="stats">
      <thead><tr><th /><th style={{ color: colors[0] }}>{names[0]}</th><th style={{ color: colors[1] }}>{names[1]}</th></tr></thead>
      <tbody>{rows.map(([l, f]) => <tr key={l}><td className="muted">{l}</td><td>{f(stats[0])}</td><td>{f(stats[1])}</td></tr>)}</tbody>
    </table>
  );
}

function LossCauses({ stats }: { stats: [SideStats, SideStats] }) {
  const causes = Object.keys(stats[0].lossesByCause ?? {}) as (keyof SideStats['lossesByCause'])[];
  const nz = causes.filter((c) => (stats[0].lossesByCause[c] ?? 0) + (stats[1].lossesByCause[c] ?? 0) > 0);
  if (nz.length === 0) return null;
  return (
    <table className="stats small">
      <thead><tr><th>Losses by cause</th><th /><th /></tr></thead>
      <tbody>{nz.map((c) => <tr key={c}><td className="muted">{c}</td><td>{fmt(stats[0].lossesByCause[c])}</td><td>{fmt(stats[1].lossesByCause[c])}</td></tr>)}</tbody>
    </table>
  );
}

/** Days over which the dashboard trend arrows are measured. */
const TREND_DAYS = 7;

function RunStatus() {
  const run = useStore((s) => s.run);
  const limit = useStore((s) => s.scenario.victory.timeLimitDays);
  const result = run.result;
  const { names } = useSides();
  const state = run.status === 'starting' ? 'Starting'
    : run.status === 'ended' ? (result ? (result.winner === 'draw' ? 'Ended: draw' : `Ended: ${names[result.winner]} won`) : 'Ended')
    : run.speed > 0 ? `Running, ${fmtSpeed(run.speed)}` : 'Paused';
  const cls = run.status === 'ended' ? 'ended' : run.status === 'running' && run.speed > 0 ? 'running' : 'paused';
  const reached = Math.min(1, run.day / Math.max(1, limit));
  return (
    <div className="rp-status">
      <div className="rp-status-row">
        <div>
          <div className="rp-day">Day {run.day.toLocaleString('en-US')}</div>
          <div className="rp-muted small">{run.date ? run.date.replace(/^Day \d+,\s*/, '') : '-'}{run.theater ? ` | grid ${run.theater.cols}x${run.theater.rows} at ${run.theater.cellDeg} deg` : ''}</div>
        </div>
        <span className={`rp-pill rp-pill-${cls}`}>{state}</span>
      </div>
      <div className="rp-limit" title={`Time limit ${limit} days: the run ends then if no other victory condition fires first`}>
        <div style={{ width: `${reached * 100}%` }} />
      </div>
      <div className="rp-muted small rp-status-foot">
        <span>{run.day} of {limit} days (time limit)</span>
        <ModelTag />
      </div>
    </div>
  );
}

function Trend({ d, fmtD, goodUp }: { d: number | null; fmtD: (v: number) => string; goodUp?: boolean }) {
  if (d == null) return null;
  const dir = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down';
  const tone = dir === 'flat' || goodUp == null ? '' : (dir === 'up') === goodUp ? ' rp-good' : ' rp-bad';
  return <span className={`rp-trend${tone}`} title={`Change over the last ${TREND_DAYS} days`}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'} {fmtD(d)}</span>;
}

interface VsSpec {
  label: string;
  hint: string;
  series: [number[], number[]];
  /** ratio: the bar splits the two sides' values; level: each side's own 0..1 level. */
  mode: 'ratio' | 'level';
  value: (v: number) => string;
  delta: (v: number) => string;
  goodUp: boolean;
  sub?: (s: 0 | 1, v: number) => string | null;
}

function VsRow({ spec, colors }: { spec: VsSpec; colors: [string, string] }) {
  const n = history.day.length - 1;
  if (n < 0) return null;
  const v: [number, number] = [spec.series[0][n], spec.series[1][n]];
  const d = [0, 1].map((s) => deltaOver(history.day, spec.series[s], TREND_DAYS));
  const side = (s: 0 | 1) => (
    <div className={`rp-vs-side rp-vs-${s}`}>
      <b>{spec.value(v[s])}</b>
      <Trend d={d[s]} fmtD={spec.delta} goodUp={spec.goodUp} />
      {spec.sub && <span className="rp-muted small">{spec.sub(s, v[s])}</span>}
    </div>
  );
  return (
    <div className="rp-vs" title={spec.hint}>
      <div className="rp-vs-label">{spec.label}</div>
      {side(0)}
      {spec.mode === 'ratio'
        ? <div className="rp-split" aria-hidden><div style={{ width: `${share(v[0], v[1]) * 100}%`, background: colors[0] }} /><div style={{ flex: 1, background: colors[1] }} /></div>
        : <div className="rp-levels" aria-hidden>
            <div className="rp-level"><div style={{ width: `${Math.max(0, Math.min(1, v[0])) * 100}%`, background: colors[0] }} /></div>
            <div className="rp-level"><div style={{ width: `${Math.max(0, Math.min(1, v[1])) * 100}%`, background: colors[1] }} /></div>
          </div>}
      {side(1)}
    </div>
  );
}

function Dashboard({ names, colors }: { names: [string, string]; colors: [string, string] }) {
  useStore((s) => s.run.historyVersion);
  const start = (s: 0 | 1) => history.personnel[s][0];
  const specs: VsSpec[] = [
    { label: 'Strength', hint: 'Personnel in the theater now; the bar splits the two sides', series: history.personnel, mode: 'ratio', value: (v) => fmt(v), delta: (v) => signed(v), goodUp: true,
      sub: (s, v) => (start(s) > 0 ? `${pct(v / start(s))} of start` : null) },
    { label: 'Casualties', hint: 'Cumulative killed, wounded and captured; the bar splits the two sides', series: history.casualties, mode: 'ratio', value: (v) => fmt(v), delta: (v) => signed(v), goodUp: false },
    { label: 'Morale', hint: 'Strength-weighted average morale, 0-100%', series: history.morale, mode: 'level', value: pct, delta: signedPts, goodUp: true },
    { label: 'Territory', hint: 'Share of the theater\'s land cells each side controls', series: history.territory, mode: 'level', value: pct, delta: signedPts, goodUp: true },
  ];
  return (
    <div className="rp-dash">
      <div className="rp-vs rp-vs-head">
        <div />
        <div className="rp-vs-side rp-vs-0" style={{ color: colors[0] }}>{names[0]}</div>
        <div />
        <div className="rp-vs-side rp-vs-1" style={{ color: colors[1] }}>{names[1]}</div>
      </div>
      {specs.map((s) => <VsRow key={s.label} spec={s} colors={colors} />)}
      <div className="rp-muted small">Arrows: change over the last {TREND_DAYS} simulated days.</div>
    </div>
  );
}

function Live() {
  const run = useStore((s) => s.run);
  const { names, colors: raw } = useSides();
  const colors = useLegibleColors(raw);
  if (run.status === 'idle') {
    return <div className="panel-body muted">No run yet. Build a scenario (or load a preset) and press <b>Run war</b>. Charts, the event log and the result appear here.</div>;
  }
  if (run.status === 'error') return <div className="panel-body"><div className="notice warn">{run.engineError}</div></div>;
  const v = run.historyVersion;
  return (
    <div className="panel-body">
      <RunStatus />
      {run.status === 'ended' && run.result && (
        <button className="rp-linkbtn" onClick={() => store.set({ rightTab: 'result' })}>See the result and the reasons</button>
      )}
      {run.warnings.length > 0 && <ul className="warnings">{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {history.day.length > 0 && <Dashboard names={names} colors={colors} />}
      <h4>Over time</h4>
      <SideLegend names={names} colors={raw} />
      <SideChart title="Strength" unit="personnel" days={history.day} series={history.personnel} names={names} colors={raw} version={v} sync="live" />
      <SideChart title="Casualties (cumulative)" unit="personnel" days={history.day} series={history.casualties} names={names} colors={raw} version={v} sync="live" />
      <SideChart title="Morale" unit="% (avg)" days={history.day} series={history.morale} names={names} colors={raw} version={v} percent sync="live" />
      <SideChart title="Territory held" unit="% of land" days={history.day} series={history.territory} names={names} colors={raw} version={v} percent sync="live" />
      <SideChart title="Supply" unit="% of needs met" days={history.day} series={history.supply} names={names} colors={raw} version={v} percent sync="live" />
      {run.stats && (
        <details className="rp-details">
          <summary>All statistics today</summary>
          <StatsTable stats={run.stats} />
          <LossCauses stats={run.stats} />
        </details>
      )}
    </div>
  );
}

// Event filter survives switching tabs (the Events view unmounts); reset per page load only.
const eventFilterMemo: { groups: EventGroup[]; side: EventFilter['side']; query: string } = { groups: [], side: '', query: '' };

function Events() {
  const ver = useStore((s) => s.run.eventsVersion);
  const { names, colors: raw } = useSides();
  const colors = useLegibleColors(raw);
  const [groups, setGroups] = useState<EventGroup[]>(eventFilterMemo.groups);
  const [side, setSide] = useState<EventFilter['side']>(eventFilterMemo.side);
  const [query, setQuery] = useState(eventFilterMemo.query);
  const [picked, setPicked] = useState<SimEvent | null>(null);
  useEffect(() => { Object.assign(eventFilterMemo, { groups, side, query }); }, [groups, side, query]);
  const { list, matched, counts } = useMemo(() => {
    const r = filterEvents(eventLog, { groups: new Set(groups), side, query });
    return { ...r, counts: groupCounts(eventLog) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, groups, side, query]);
  const toggle = (g: EventGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const go = (e: SimEvent) => {
    setPicked(e);
    if (e.lat != null && e.lon != null) flyBus.emit({ lon: e.lon, lat: e.lat });
  };
  const filtered = groups.length > 0 || side !== '' || query.trim() !== '';
  return (
    <div className="panel-body">
      <div className="rp-chips" role="group" aria-label="Event types">
        <button className={`rp-chip${groups.length === 0 ? ' on' : ''}`} aria-pressed={groups.length === 0} onClick={() => setGroups([])}>All <span>{eventLog.length}</span></button>
        {EVENT_GROUPS.filter((g) => counts[g.id] > 0 || groups.includes(g.id) || g.id === 'battles' || g.id === 'captures' || g.id === 'collapses').map((g) => (
          <button key={g.id} className={`rp-chip${groups.includes(g.id) ? ' on' : ''}`} aria-pressed={groups.includes(g.id)} onClick={() => toggle(g.id)} title={`Event kinds: ${g.kinds.join(', ')}`}>
            {g.label} <span>{counts[g.id]}</span>
          </button>
        ))}
      </div>
      <div className="rp-evtools">
        <div className="rp-seg" role="group" aria-label="Side">
          {([['', 'Both'], ['0', names[0]], ['1', names[1]]] as [EventFilter['side'], string][]).map(([v, l]) => (
            <button key={v} className={side === v ? 'on' : ''} aria-pressed={side === v} onClick={() => setSide(v)} style={v !== '' ? { borderBottomColor: colors[+v] } : undefined}>{l}</button>
          ))}
        </div>
        <input type="search" placeholder="Search event text" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search events" />
      </div>
      <div className="rp-muted small rp-evcount">
        {filtered ? `${matched} of ${eventLog.length} events match` : `${eventLog.length} events`}
        {matched > list.length ? `, newest ${list.length} shown` : ''}. Click an event with a pin to pan the map to it.
        {filtered && <button className="rp-textbtn" onClick={() => { setGroups([]); setSide(''); setQuery(''); }}>Clear filters</button>}
      </div>
      {list.length === 0 && <p className="muted">{eventLog.length === 0 ? 'No events yet.' : 'No events match the filters.'}</p>}
      <ul className="rp-events">
        {list.map((e, i) => {
          const located = e.lat != null && e.lon != null;
          return (
            <li key={`${e.day}-${i}`}>
              <button className={`rp-ev rp-ev-${groupOf(e.kind) ?? 'other'}${picked === e ? ' picked' : ''}${located ? ' located' : ''}`} onClick={() => go(e)}
                style={{ borderLeftColor: e.side === -1 ? 'var(--muted, #8b949e)' : colors[e.side] }}
                title={located ? `Pan the map to ${e.lat!.toFixed(2)}, ${e.lon!.toFixed(2)}` : 'No map location for this event'}>
                <span className="rp-ev-meta">
                  <span className="rp-ev-day">day {e.day}</span>
                  <span className="rp-ev-kind">{e.kind}</span>
                  {located && <svg className="rp-ev-pin" width="10" height="12" viewBox="0 0 10 12" aria-label="has map location"><path d="M5 0a4 4 0 0 0-4 4c0 3 4 8 4 8s4-5 4-8a4 4 0 0 0-4-4zm0 5.5A1.5 1.5 0 1 1 5 2.5a1.5 1.5 0 0 1 0 3z" fill="currentColor" /></svg>}
                </span>
                <span className="rp-ev-text">{e.text}</span>
                {e.why && <span className="rp-ev-why">Why: {e.why}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Reasons({ reasons, names, colors }: { reasons: Reason[]; names: [string, string]; colors: [string, string] }) {
  return (
    <ol className="reasons">
      {reasons.map((r, i) => (
        <li key={i}>
          <div className="reason-head">
            <b>{r.factor}</b> <span className="muted small">favoured</span> <span style={{ color: colors[r.side] }}>{names[r.side]}</span>
            <span className="reason-w">{Math.round(r.weight * 100)}%</span>
          </div>
          <div className="bar"><div style={{ width: `${Math.round(r.weight * 100)}%`, background: colors[r.side] }} /></div>
          <div className="small">{r.detail}</div>
        </li>
      ))}
    </ol>
  );
}

function Result() {
  const result = useStore((s) => s.run.result);
  const { names, colors } = useSides();
  if (!result) return <div className="panel-body muted">The result appears here when the run ends (a victory condition fires or the time limit is reached).</div>;
  const w = result.winner;
  return (
    <div className="panel-body">
      <div className="result-head" style={{ borderColor: w === 'draw' ? '#8b949e' : colors[w] }}>
        <div className="small muted">Result after {result.endDay} days <ModelTag /></div>
        <div className="winner">{w === 'draw' ? 'Draw' : `${names[w]} wins`}</div>
        <div className="small">{result.endReason} | seed {result.seed}</div>
      </div>
      <StatsTable stats={result.stats} />
      <h4>Why (ranked)</h4>
      <Reasons reasons={result.reasons} names={names} colors={colors} />
      <p className="small muted">One run of a stochastic model. Use Monte Carlo to see how often this outcome happens.</p>
    </div>
  );
}

function Pcts({ p, f = fmt }: { p: { p10: number; p50: number; p90: number }; f?: (v: number) => string }) {
  return <span>{f(p.p10)} / <b>{f(p.p50)}</b> / {f(p.p90)}</span>;
}

function MonteCarlo() {
  const mc = useStore((s) => s.mc);
  const sc = useStore((s) => s.scenario);
  const { names, colors } = useSides();
  const [runs, setRuns] = useState(200);
  const r = mc.result;
  return (
    <div className="panel-body">
      <div className="row">
        <label>Runs <input className="narrow" type="number" min={2} max={5000} value={runs} onChange={(e) => setRuns(Math.max(2, Math.min(5000, Math.trunc(+e.target.value) || 2)))} /></label>
        {mc.status === 'running'
          ? <button onClick={cancelMonteCarlo}>Cancel</button>
          : <button className="primary" onClick={() => runMonteCarlo(sc, runs)}>Run Monte Carlo</button>}
      </div>
      <p className="small muted">Runs the current scenario N times with different seeds (seed, seed+1, ...) in a separate worker.</p>
      {mc.status === 'running' && (
        <div className="progress"><div style={{ width: `${(100 * mc.done) / Math.max(1, mc.total)}%` }} /><span>{mc.done} / {mc.total}</span></div>
      )}
      {mc.status === 'error' && <div className="notice warn">{mc.error}</div>}
      {r && (
        <>
          <h4>Win probability over {r.runs} runs <ModelTag /></h4>
          {([0, 1, 2] as const).map((i) => (
            <div key={i} className="wp">
              <span>{i === 2 ? 'Draw' : names[i]}</span>
              <div className="bar"><div style={{ width: `${r.winProb[i] * 100}%`, background: i === 2 ? '#8b949e' : colors[i] }} /></div>
              <b>{(r.winProb[i] * 100).toFixed(1)}%</b>
            </div>
          ))}
          <table className="stats small">
            <thead><tr><th>p10 / p50 / p90</th><th /></tr></thead>
            <tbody>
              <tr><td className="muted">War length (days)</td><td><Pcts p={r.endDay} f={(v) => String(Math.round(v))} /></td></tr>
              <tr><td className="muted">Casualties {names[0]}</td><td><Pcts p={r.casualties[0]} /></td></tr>
              <tr><td className="muted">Casualties {names[1]}</td><td><Pcts p={r.casualties[1]} /></td></tr>
            </tbody>
          </table>
          <h4>Most common reasons</h4>
          <Reasons reasons={r.topReasons} names={names} colors={colors} />
          <p className="small muted">Spread reflects the model's randomness (seeds) only, not uncertainty in the input data. Edit values within their low-high range to probe that.</p>
        </>
      )}
    </div>
  );
}

export function RunPanel() {
  const tab = useStore((s) => s.rightTab);
  const hasResult = useStore((s) => !!s.run.result);
  const mcRunning = useStore((s) => s.mc.status === 'running');
  const tabs: [RightTab, string][] = [['live', 'Live'], ['events', 'Events'], ['result', hasResult ? 'Result *' : 'Result'], ['montecarlo', mcRunning ? 'Monte Carlo ...' : 'Monte Carlo']];
  return (
    <aside className="right">
      <nav className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => store.set({ rightTab: k })}>{l}</button>)}
      </nav>
      {tab === 'live' && <Live />}
      {tab === 'events' && <Events />}
      {tab === 'result' && <Result />}
      {tab === 'montecarlo' && <MonteCarlo />}
    </aside>
  );
}
