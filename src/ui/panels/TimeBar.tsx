import { useEffect, useState } from 'react';
import { REAL_TIME, seek, setSpeed, startRun, stepDays, stopRun } from '../engine';
import { Icon } from '../Icon';
import { store, useStore } from '../store';

const SPEEDS: [number, string, string][] = [
  [REAL_TIME, 'Real', 'Real time: 1 simulated second per second'],
  [1, '1 d/s', '1 day per second'],
  [3, '3 d/s', '3 days per second (about 1 month per 10 s)'],
  [7, '7 d/s', '7 days per second'],
  [30, '30 d/s', '30 days per second'],
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
  const active = run.status === 'running' || run.status === 'ended';
  const max = Math.max(limit, run.maxDay, 1);
  const shown = scrub ?? run.day;
  const dayText = scrub != null ? `seek to day ${scrub}` : run.status === 'starting' ? 'starting...' : active ? `${run.date || ''} (day ${run.day})` : 'not running';
  return (
    <div className="timebar" role="group" aria-label="Simulation playback">
      <div className="tb-controls">
        {run.status === 'idle' || run.status === 'error'
          ? <button className="primary tb-run" onClick={() => startRun(store.get().scenario, 3)}><Icon name="play" size={14} />Run war</button>
          : <button className="tb-run" onClick={stopRun} title="Stop and clear this run"><Icon name="stop" size={14} />Stop</button>}
        <button disabled={!active} className={`icon-btn${active && run.speed === 0 ? ' on' : ''}`} aria-pressed={active && run.speed === 0} onClick={() => setSpeed(0)} title="Pause (space)" aria-label="Pause (space)"><Icon name="pause" size={14} /></button>
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map(([v, l, t]) => (
            <button key={l} disabled={!active} className={active && run.speed === v ? 'on' : ''} aria-pressed={active && run.speed === v} title={t} onClick={() => setSpeed(v)}>{l}</button>
          ))}
        </div>
        <button disabled={!active} className="icon-btn" onClick={() => stepDays(1)} title="Step one day (.)" aria-label="Step one day (.)"><Icon name="step" size={14} /></button>
      </div>
      <div className="tb-scrub">
        <div className="scrub">
          <input type="range" min={0} max={max} step={1} disabled={!active}
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
