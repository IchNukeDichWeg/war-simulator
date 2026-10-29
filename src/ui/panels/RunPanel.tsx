import { useMemo, useState } from 'react';
import type { Reason, SideStats, SimEvent } from '../../engine/protocol';
import { flyBus } from '../bus';
import { cancelMonteCarlo, eventLog, history, runMonteCarlo } from '../engine';
import { fmt, pct } from '../format';
import { GradeBadge } from '../Grade';
import { store, useStore, type RightTab } from '../store';
import { SideChart } from './Charts';

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

function Live() {
  const run = useStore((s) => s.run);
  const { names, colors } = useSides();
  if (run.status === 'idle') {
    return <div className="panel-body muted">No run yet. Build a scenario (or load a preset) and press <b>Run war</b>. Charts, the event log and the result appear here.</div>;
  }
  if (run.status === 'error') return <div className="panel-body"><div className="notice warn">{run.engineError}</div></div>;
  const v = run.historyVersion;
  return (
    <div className="panel-body">
      <div className="run-head">
        <b>{run.date || `Day ${run.day}`}</b> <span className="muted">day {run.day}{run.theater ? ` | grid ${run.theater.cols}x${run.theater.rows} @ ${run.theater.cellDeg} deg` : ''}</span>
        <ModelTag />
      </div>
      {run.warnings.length > 0 && <ul className="warnings">{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {run.stats && <StatsTable stats={run.stats} />}
      <SideChart title="Strength (personnel)" days={history.day} series={history.personnel} names={names} colors={colors} version={v} />
      <SideChart title="Casualties (cumulative)" days={history.day} series={history.casualties} names={names} colors={colors} version={v} />
      <SideChart title="Supply (fraction of needs met)" days={history.day} series={history.supply} names={names} colors={colors} version={v} percent />
      <SideChart title="Morale" days={history.day} series={history.morale} names={names} colors={colors} version={v} percent />
      <SideChart title="Territory held" days={history.day} series={history.territory} names={names} colors={colors} version={v} percent />
      {run.stats && <LossCauses stats={run.stats} />}
    </div>
  );
}

const KINDS: SimEvent['kind'][] = ['battle', 'rout', 'siege', 'capture', 'supply', 'naval', 'air', 'mobilization', 'arrival', 'nuclear', 'weather', 'end'];

function Events() {
  const ver = useStore((s) => s.run.eventsVersion);
  const { names, colors } = useSides();
  const [kind, setKind] = useState<string>('');
  const [side, setSide] = useState<string>('');
  const list = useMemo(() => {
    const out: SimEvent[] = [];
    for (let i = eventLog.length - 1; i >= 0 && out.length < 400; i--) {
      const e = eventLog[i];
      if (kind && e.kind !== kind) continue;
      if (side !== '' && String(e.side) !== side) continue;
      out.push(e);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, kind, side]);
  return (
    <div className="panel-body">
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select value={side} onChange={(e) => setSide(e.target.value)}><option value="">Both sides</option><option value="0">{names[0]}</option><option value="1">{names[1]}</option></select>
        <span className="muted small">{eventLog.length} events</span>
      </div>
      {list.length === 0 && <p className="muted">No events yet.</p>}
      <ul className="events">
        {list.map((e, i) => (
          <li key={i} className={`ev ev-${e.kind}`} onClick={() => e.lat != null && e.lon != null && flyBus.emit({ lon: e.lon, lat: e.lat })}
            style={{ borderLeftColor: e.side === -1 ? '#8b949e' : colors[e.side] }}>
            <div><span className="ev-day">d{e.day}</span> <span className="ev-kind">{e.kind}</span> {e.text}</div>
            {e.why && <div className="ev-why">why: {e.why}</div>}
          </li>
        ))}
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
