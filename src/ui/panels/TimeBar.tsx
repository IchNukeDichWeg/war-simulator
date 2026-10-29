import { useEffect, useState } from 'react';
import { REAL_TIME, seek, setSpeed, startRun, stepDays, stopRun } from '../engine';
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
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.code === 'Space' && store.get().run.status === 'running') { e.preventDefault(); setSpeed(store.get().run.speed > 0 ? 0 : 3); }
      if (e.key === '.' && store.get().run.status === 'running') stepDays(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const active = run.status === 'running' || run.status === 'ended';
  const max = Math.max(limit, run.maxDay, 1);
  return (
    <div className="timebar">
      {run.status === 'idle' || run.status === 'error'
        ? <button className="primary" onClick={() => startRun(store.get().scenario, 3)}>Run war</button>
        : <button onClick={stopRun} title="Stop and clear this run">Stop</button>}
      <button disabled={!active} className={run.speed === 0 ? 'on' : ''} onClick={() => setSpeed(0)} title="Pause (space)">Pause</button>
      {SPEEDS.map(([v, l, t]) => (
        <button key={l} disabled={!active} className={run.speed === v ? 'on' : ''} title={t} onClick={() => setSpeed(v)}>{l}</button>
      ))}
      <button disabled={!active} onClick={() => stepDays(1)} title="Step one day (.)">+1 day</button>
      <div className="scrub">
        <input type="range" min={0} max={max} step={1} disabled={!active}
          value={scrub ?? run.day}
          onChange={(e) => setScrub(+e.target.value)}
          onPointerUp={() => { if (scrub != null) { setSpeed(0); seek(scrub); } setScrub(null); }}
          onKeyUp={() => { if (scrub != null) { setSpeed(0); seek(scrub); } setScrub(null); }} />
        <div className="scrub-reached" style={{ width: `${(100 * run.maxDay) / max}%` }} />
      </div>
      <span className="daylabel">{scrub != null ? `seek to day ${scrub}` : run.status === 'starting' ? 'starting...' : active ? `${run.date || ''} (day ${run.day})` : 'not running'}</span>
    </div>
  );
}
