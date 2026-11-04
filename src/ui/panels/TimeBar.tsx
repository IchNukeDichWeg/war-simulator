import { useEffect, useState } from 'react';
import { REAL_TIME, seek, setSpeed, startRun, stepDays, stopRun } from '../engine';
import { Icon } from '../Icon';
import { store, useStore } from '../store';

// Three named speeds cover what a visitor needs; the exact-rate menu keeps every rate the engine offers.
const SPEEDS: [number, string, string][] = [
  [1, 'Slow', 'Slow: 1 day per second'],
  [3, 'Normal', 'Normal: 3 days per second (about 1 month per 10 s)'],
  [30, 'Fast', 'Fast: 30 days per second'],
];
const EXACT: [number, string][] = [
  [REAL_TIME, 'Real time'],
  [1, '1 day/s'],
  [3, '3 days/s'],
  [7, '7 days/s'],
  [30, '30 days/s'],
];

export function TimeBar() {
  const run = useStore((s) => s.run);
  const limit = useStore((s) => s.scenario.victory.timeLimitDays);
  const [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space belongs to the focused control (it presses buttons, switches tabs) and to an open
      // modal (it scrolls the Honest-limits page); playback only gets it from the bare page.
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,button,a,[role=tab],[role=dialog],[contenteditable]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.code === 'Space' && store.get().run.status === 'running') { e.preventDefault(); setSpeed(store.get().run.speed > 0 ? 0 : 3); }
      if (e.key === '.' && store.get().run.status === 'running') stepDays(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const max = Math.max(limit, run.maxDay, 1);
  const shown = scrub ?? run.day;
  const dayText = scrub != null ? `seek to day ${scrub}` : `${run.date || ''} (day ${run.day})`;
  // before a run there is nothing to play back: only the Run button and a hint
  if (run.status === 'idle' || run.status === 'error') {
    return (
      <div className="timebar idle" role="group" aria-label="Simulation playback">
        <button className="primary tb-run" onClick={() => startRun(store.get().scenario, 3)}><Icon name="play" size={14} />Run war</button>
        <span className="tb-hint">{run.status === 'error' ? 'The run failed. Press Run war to try again.' : 'Press Run war to start'}</span>
      </div>
    );
  }
  // loading the engine and its data: the run can already be cancelled, playback comes once it ticks
  if (run.status === 'starting') {
    return (
      <div className="timebar idle" role="group" aria-label="Simulation playback">
        <button className="tb-run" onClick={stopRun} title="Stop and clear this run"><Icon name="stop" size={14} />Stop</button>
        <span className="tb-hint" role="status">Starting...</span>
      </div>
    );
  }
  const paused = run.speed === 0;
  return (
    <div className="timebar" role="group" aria-label="Simulation playback">
      <div className="tb-controls">
        <button className="tb-run" onClick={stopRun} title="Stop and clear this run"><Icon name="stop" size={14} />Stop</button>
        <div className="seg" role="group" aria-label="Speed">
          <button className={paused ? 'on' : ''} aria-pressed={paused} onClick={() => setSpeed(0)} title="Pause (space)" aria-label="Pause (space)"><Icon name="pause" size={12} /><span className="tb-lbl">Pause</span></button>
          {SPEEDS.map(([v, l, t]) => (
            <button key={l} className={run.speed === v ? 'on' : ''} aria-pressed={run.speed === v} title={t} onClick={() => setSpeed(v)}>{l}</button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => stepDays(1)} title="Step one day (.)" aria-label="Step one day (.)"><Icon name="step" size={14} /></button>
        <select className="tb-exact" value={run.speed} onChange={(e) => setSpeed(+e.target.value)} title="Exact speed in simulated days per second" aria-label="Exact speed">
          {run.speed === 0 && <option value={0} disabled>Paused</option>}
          {!EXACT.some(([v]) => v === run.speed) && run.speed !== 0 && <option value={run.speed} disabled>{run.speed} days/s</option>}
          {EXACT.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="tb-scrub">
        <div className="scrub">
          <input type="range" min={0} max={max} step={1}
            aria-label="Simulation day" aria-valuetext={dayText}
            style={{ '--pct': `${(100 * shown) / max}%` } as React.CSSProperties}
            value={shown}
            onChange={(e) => setScrub(+e.target.value)}
            onPointerUp={() => { if (scrub != null) { setSpeed(0); seek(scrub); } setScrub(null); }}
            onKeyUp={() => { if (scrub != null) { setSpeed(0); seek(scrub); } setScrub(null); }} />
          <div className="scrub-reached" style={{ width: `${(100 * run.maxDay) / max}%` }} />
        </div>
        <span className="daylabel">{dayText}</span>
      </div>
    </div>
  );
}
