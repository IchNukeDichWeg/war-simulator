import { yearLabel, yearOf, type AppData } from '../data';
import { startRun } from '../engine';
import { normalizeScenario } from '../scenarioDefaults';
import { ensureSnapshots } from '../lazy';
import { store, toast, useStore, type LeftTab } from '../store';
import type { Scenario, TechMode } from '../../types/scenario';
import { EmptyData } from './EmptyData';
import { Icon } from '../Icon';
import '../../styles/start.css';

/** Resolves once every member snapshot is loaded (Phase 3 members load their era file).
 *  `tab` is the left tab to show afterwards; null keeps the current one (Run from Quick start). */
export function loadScenario(s: Scenario, msg = 'Scenario loaded', tab: LeftTab | null = 'setup'): Promise<boolean> {
  const sc = normalizeScenario(structuredClone(s));
  store.set({ scenario: sc, scenarioDirty: false, mapMode: { kind: 'none' }, ...(tab ? { leftTab: tab } : {}) });
  toast(msg);
  return ensureSnapshots(sc.sides.flatMap((x) => x.members));
}

const TECH: Record<TechMode, string> = { native: 'own-era tech', equalized: 'tech equalized', timeslice: 'mixed years' };

/** "117 vs 2026", or one label when both sides share the same years. */
function yearsOf(d: AppData, p: Scenario): string {
  const span = (ids: string[]) => {
    const ys = ids.map((id) => yearOf(d, id)).filter((y): y is number => y !== undefined);
    if (ys.length === 0) return '';
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return lo === hi ? yearLabel(lo) : `${yearLabel(lo)}-${yearLabel(hi)}`;
  };
  const [a, b] = p.sides.map((s) => span(s.members));
  return a === b ? a : a && b ? `${a} vs ${b}` : a || b;
}

const runPreset = (p: Scenario) => { void loadScenario(p, `Running ${p.name}`, null).then(() => startRun(store.get().scenario, 3)); };

export function Presets() {
  const data = useStore((s) => s.data);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (data.presets.length === 0) return <EmptyData what="preset scenarios" file="presets.json" />;
  const name = (id: string) => { const s = data.snapById.get(id); return s ? `${s.name} ${yearLabel(s.year)}` : id; };
  return (
    <div className="panel-body start">
      <div className="start-intro">
        <h2 className="start-title">Pick a matchup</h2>
        <p className="muted">Press Run to watch it on the map, or build your own in Setup.</p>
        <button className="start-own" onClick={() => store.set({ leftTab: 'setup', leftOpen: true })}>
          <Icon name="sliders" size={14} />Build your own matchup
        </button>
      </div>
      <ul className="presets" aria-label="Ready matchups">
        {data.presets.map((p) => {
          const years = yearsOf(data, p);
          const coalitions = p.sides.filter((s) => s.members.length > 1);
          return (
            <li key={p.id} className="preset-card">
              <h3 className="preset-name">{p.name}</h3>
              <div className="preset-meta">
                {years && <span className="preset-years">{years}</span>}
                <span>{TECH[p.techMode] ?? p.techMode}</span>
              </div>
              <div className="preset-theater">{p.theater.name}{p.excluded.length > 0 ? `, excludes ${p.excluded.join(', ')}` : ''}</div>
              <div className="preset-sides small">
                {p.sides.map((s, i) => (
                  <span key={i} className="preset-side">
                    {i > 0 && <span className="preset-vs muted">vs</span>}
                    <span className="dot" style={{ background: s.color }} />
                    <span className="preset-side-name">{s.name}</span>
                  </span>
                ))}
              </div>
              {coalitions.map((s, i) => (
                <div key={i} className="small muted preset-members">
                  {s.name}: {s.members.slice(0, 4).map(name).join(', ')}{s.members.length > 4 ? ` +${s.members.length - 4}` : ''}
                </div>
              ))}
              {p.description && <p className="small muted preset-desc" title={p.description}>{p.description}</p>}
              <div className="preset-actions">
                <button aria-label={`Customize ${p.name} in Setup`} title="Load it into Setup to change sides, rules or theater"
                  onClick={() => loadScenario(p, `Loaded ${p.name} into Setup`)}>Customize</button>
                <button className="primary" aria-label={`Run ${p.name}`} onClick={() => runPreset(p)}><Icon name="play" size={12} />Run</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
