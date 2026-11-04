import { useEffect, useMemo, useState } from 'react';
import type { SideStats, SimEvent } from '../../engine/protocol';
import { flyBus } from '../bus';
import { Icon } from '../Icon';
import { eventLog, history } from '../engine';
import { capitalize, fmt, fmtCount, fmtDays, fmtSpeed, pct, signed, signedPts } from '../format';
import { deltaOver, EVENT_GROUPS, filterEvents, groupCounts, groupOf, share, type EventFilter, type EventGroup } from '../runStats';
import { store, useStore, type RightTab } from '../store';
import { SideChart, SideLegend, useLegibleColors } from './Charts';
import { MonteCarloView } from './MonteCarloView';
import { ModelTag, Reasons, useSides } from './RunShared';
// after the panel imports so its rules land after results.css (which Charts imports)
import '../../styles/run.css';

function StatsTable({ stats }: { stats: [SideStats, SideStats] }) {
  const { names, colors } = useSides();
  const rows: [string, (s: SideStats) => string][] = [
    ['Personnel', (s) => fmtCount(s.personnel)],
    ['Platforms', (s) => fmt(s.platforms)],
    ['Casualties', (s) => fmtCount(s.casualties)],
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
      <tbody>{nz.map((c) => <tr key={c}><td className="muted">{c}</td><td>{fmtCount(stats[0].lossesByCause[c])}</td><td>{fmtCount(stats[1].lossesByCause[c])}</td></tr>)}</tbody>
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
          <div className="rp-muted small">{run.date ? run.date.replace(/^Day \d+,\s*/, '') : '-'}</div>
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

function Trend({ d, fmtD, goodUp, eps }: { d: number | null; fmtD: (v: number) => string; goodUp?: boolean; eps: number }) {
  if (d == null) return null;
  const dir = Math.abs(d) < eps ? 'flat' : d > 0 ? 'up' : 'down';
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
  /** Changes smaller than this show as flat (they would print as 0). */
  eps: number;
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
      <Trend d={d[s]} fmtD={spec.delta} goodUp={spec.goodUp} eps={spec.eps} />
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
    { label: 'Strength', hint: 'Personnel in the theater now; the bar splits the two sides', series: history.personnel, mode: 'ratio', value: fmtCount, delta: (v) => signed(v), goodUp: true, eps: 0.5,
      sub: (s, v) => (start(s) > 0 ? `${pct(v / start(s))} of start` : null) },
    { label: 'Casualties', hint: 'Cumulative killed, wounded and captured; the bar splits the two sides', series: history.casualties, mode: 'ratio', value: fmtCount, delta: (v) => signed(v), goodUp: false, eps: 0.5 },
    { label: 'Morale', hint: 'Strength-weighted average morale, 0-100%', series: history.morale, mode: 'level', value: pct, delta: signedPts, goodUp: true, eps: 0.005 },
    { label: 'Territory', hint: 'Share of the theater\'s land cells each side controls', series: history.territory, mode: 'level', value: pct, delta: signedPts, goodUp: true, eps: 0.005 },
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
      <div className="rp-muted small">Arrows show the change over the last {TREND_DAYS} days.</div>
    </div>
  );
}

// "More charts" stays open across tab switches (the Live view unmounts); reset per page load only.
const liveMemo = { moreCharts: false };

function Live() {
  const run = useStore((s) => s.run);
  const { names, colors: raw } = useSides();
  const colors = useLegibleColors(raw);
  const [more, setMore] = useState(liveMemo.moreCharts);
  if (run.status === 'idle') {
    return (
      <div className="panel-body empty">
        <div className="empty-icon"><Icon name="play" size={22} /></div>
        <p><b>No war running yet.</b></p>
        <p className="muted">Pick a matchup in Quick start or Setup, then press <b>Run war</b> to watch it here.</p>
      </div>
    );
  }
  if (run.status === 'error') return <div className="panel-body"><div className="notice warn">{run.engineError}</div></div>;
  const v = run.historyVersion;
  const chart = (title: string, unit: string, series: [number[], number[]], percent = false) => (
    <SideChart title={title} unit={unit} days={history.day} series={series} names={names} colors={raw} version={v} percent={percent} sync="live" />
  );
  return (
    <div className="panel-body">
      <RunStatus />
      {run.status === 'ended' && run.result && (
        <button className="rp-linkbtn" onClick={() => store.set({ rightTab: 'result' })}>See who won and why</button>
      )}
      {run.warnings.length > 0 && <ul className="warnings">{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {history.day.length > 0 && <Dashboard names={names} colors={colors} />}
      <h4>Over time</h4>
      <SideLegend names={names} colors={raw} />
      {chart('Strength', 'personnel', history.personnel)}
      {chart('Territory held', '% of land', history.territory, true)}
      {/* charts mount only while open: a closed <details> has no width for uPlot to size to */}
      <details className="rp-details" open={more} onToggle={(e) => { const o = e.currentTarget.open; liveMemo.moreCharts = o; setMore(o); }}>
        <summary>More charts (casualties, morale, supply)</summary>
        {more && <>
          {chart('Casualties (cumulative)', 'personnel', history.casualties)}
          {chart('Morale', '% (avg)', history.morale, true)}
          {chart('Supply', '% of needs met', history.supply, true)}
        </>}
      </details>
      {run.stats && (
        <details className="rp-details">
          <summary>All statistics today</summary>
          <StatsTable stats={run.stats} />
          <LossCauses stats={run.stats} />
          {run.theater && <div className="rp-muted small">Map grid {run.theater.cols}x{run.theater.rows} cells, {run.theater.cellDeg} deg each.</div>}
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
        {matched > list.length ? `, newest ${list.length} shown` : ''}. Click an event with a pin to see it on the map.
        {filtered && <button className="rp-textbtn" onClick={() => { setGroups([]); setSide(''); setQuery(''); }}>Clear filters</button>}
      </div>
      {list.length === 0 && <p className="muted">{eventLog.length === 0
        ? 'No events yet. Battles, captured cities and other turning points are listed here as the war plays out.'
        : 'No events match these filters. Clear the filters to see them all.'}</p>}
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

function Result() {
  const result = useStore((s) => s.run.result);
  const status = useStore((s) => s.run.status);
  const date = useStore((s) => (s.run.result && s.run.day === s.run.result.endDay ? s.run.date : ''));
  const { names, colors: raw } = useSides();
  const colors = useLegibleColors(raw);
  if (!result) {
    const going = status === 'running' || status === 'starting';
    return (
      <div className="panel-body empty">
        <div className="empty-icon"><Icon name="chart" size={22} /></div>
        <p><b>{going ? 'The war is still going.' : 'No result yet.'}</b></p>
        <p className="muted">{going
          ? 'Who won and why shows here as soon as one side wins or the time limit is reached.'
          : 'Run a war and this tab shows who won and why.'}</p>
      </div>
    );
  }
  const w = result.winner;
  const st = result.stats;
  const start = (s: 0 | 1) => history.personnel[s][0];
  const lossRatio = st[1].casualties > 0 && st[0].casualties > 0 ? st[0].casualties / st[1].casualties : null;
  const days = Math.round(result.endDay);
  const after = `after ${days.toLocaleString('en-US')} ${days === 1 ? 'day' : 'days'}`;
  // fmtDays adds "(about N months)" past 60 days; shown under the headline, not in it
  const about = fmtDays(result.endDay).match(/\((.*)\)$/)?.[1];
  return (
    <div className="panel-body">
      <div className={`rp-outcome${w === 'draw' ? ' draw' : ''}`} style={w === 'draw' ? undefined : { borderColor: colors[w], background: `color-mix(in srgb, ${colors[w]} 10%, var(--bg, #0d1117))` }}>
        <div className="rp-outcome-kicker">Result of this run <ModelTag /></div>
        <h3 className="rp-outcome-winner" style={{ color: w === 'draw' ? undefined : colors[w] }}>{w === 'draw' ? `Draw ${after}` : `${names[w]} wins ${after}`}</h3>
        <div className="rp-outcome-reason"><span className="rp-muted">How it ended:</span> {capitalize(result.endReason)}</div>
        <div className="rp-muted small">{[about, date ? date.replace(/^Day \d+,\s*/, '') : '', `seed ${result.seed}`].filter(Boolean).join(' | ')}</div>
      </div>
      <h4>{w === 'draw' ? 'What shaped the result' : `Why ${names[w]} won`}</h4>
      <Reasons reasons={result.reasons} names={names} colors={colors} top={3} plain />
      <div className="rp-note">
        This is one possible outcome: the model has chance in it, so another run can end differently.
        {' '}<button className="rp-textbtn" onClick={() => store.set({ rightTab: 'montecarlo' })}>See the odds</button> by running the same war many times (Monte Carlo).
      </div>
      <h4>Final numbers</h4>
      <div className="rp-final">
        {([0, 1] as const).map((s) => (
          <div key={s} className="rp-final-side" style={{ borderTopColor: colors[s] }}>
            <div className="rp-final-name" style={{ color: colors[s] }}>{names[s]}</div>
            <div><b>{fmtCount(st[s].personnel)}</b> <span className="rp-muted small">left{start(s) > 0 ? `, ${pct(st[s].personnel / start(s))} of start` : ''}</span></div>
            <div><b>{fmtCount(st[s].casualties)}</b> <span className="rp-muted small">casualties</span></div>
            <div className="small">morale {pct(st[s].morale)} | territory {pct(st[s].territory)}</div>
          </div>
        ))}
      </div>
      {lossRatio != null && (
        <div className="rp-muted small">Loss ratio {names[0]} : {names[1]} = {lossRatio >= 1 ? `${fmt(lossRatio)} : 1` : `1 : ${fmt(1 / lossRatio)}`} (killed, wounded and captured)</div>
      )}
      <details className="rp-details">
        <summary>All final statistics</summary>
        <StatsTable stats={result.stats} />
        <LossCauses stats={result.stats} />
      </details>
    </div>
  );
}

/** Tab id, label, tooltip. "Odds" is the Monte Carlo view: the label says what it answers. */
const RIGHT_TABS: [RightTab, string, string][] = [
  ['live', 'Live', 'How the war is going right now'],
  ['events', 'Events', 'Battles, captures and other moments of the war'],
  ['result', 'Result', 'Who won and why'],
  ['montecarlo', 'Odds', 'Monte Carlo: run the same war many times to see how often each side wins'],
];

export function RunPanel() {
  const tab = useStore((s) => s.rightTab);
  const hasResult = useStore((s) => !!s.run.result);
  const mcRunning = useStore((s) => s.mc.status === 'running');
  // WAI-ARIA tabs, same keys as the setup panel: arrows move, Home/End jump, Tab leaves the strip
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = RIGHT_TABS.findIndex(([k]) => k === tab);
    const n = RIGHT_TABS.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    store.set({ rightTab: RIGHT_TABS[j][0] });
    document.getElementById(`rtab-${RIGHT_TABS[j][0]}`)?.focus();
  };
  return (
    <aside className="right" aria-label="War progress and results">
      <nav className="tabs">
        <div className="tablist" role="tablist" aria-label="Run views" onKeyDown={onKey}>
          {RIGHT_TABS.map(([k, l, hint]) => {
            const ready = k === 'result' && hasResult;
            const busy = k === 'montecarlo' && mcRunning;
            return (
              <button key={k} id={`rtab-${k}`} role="tab" aria-selected={tab === k} aria-controls="right-tabpanel" tabIndex={tab === k ? 0 : -1}
                className={tab === k ? 'on' : ''} title={hint} onClick={() => store.set({ rightTab: k })}>
                {l}{busy && ' ...'}
                {ready && <span className="rp-tab-dot" aria-hidden />}
                {(ready || busy) && <span className="sr-only">{ready ? ' (ready)' : ' (running)'}</span>}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="tabpanel" role="tabpanel" id="right-tabpanel" aria-labelledby={`rtab-${tab}`}>
        {tab === 'live' && <Live />}
        {tab === 'events' && <Events />}
        {tab === 'result' && <Result />}
        {tab === 'montecarlo' && <MonteCarloView />}
      </div>
    </aside>
  );
}
