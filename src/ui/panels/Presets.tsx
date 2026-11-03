import { yearLabel } from '../data';
import { startRun } from '../engine';
import { normalizeScenario } from '../scenarioDefaults';
import { ensureSnapshots } from '../lazy';
import { store, toast, useStore } from '../store';
import type { Scenario } from '../../types/scenario';
import { EmptyData } from './EmptyData';
import { Icon } from '../Icon';

/** Resolves once every member snapshot is loaded (Phase 3 members load their era file). */
export function loadScenario(s: Scenario, msg = 'Scenario loaded'): Promise<boolean> {
  const sc = normalizeScenario(structuredClone(s));
  store.set({ scenario: sc, scenarioDirty: false, leftTab: 'scenario', mapMode: { kind: 'none' } });
  toast(msg);
  return ensureSnapshots(sc.sides.flatMap((x) => x.members));
}

export function Presets() {
  const data = useStore((s) => s.data);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (data.presets.length === 0) return <EmptyData what="preset scenarios" file="presets.json" />;
  const name = (id: string) => { const s = data.snapById.get(id); return s ? `${s.name} ${yearLabel(s.year)}` : id; };
  return (
    <div className="panel-body">
      <ul className="presets">
        {data.presets.map((p) => (
          <li key={p.id} className="preset-card">
            <b className="preset-name">{p.name}</b>
            {p.description && <p className="small muted">{p.description}</p>}
            <div className="small preset-sides">
              {p.sides.map((s, i) => (
                <div key={i} className="preset-side"><span className="dot" style={{ background: s.color }} /> <span><span className="preset-side-name">{s.name}</span>: {s.members.slice(0, 4).map(name).join(', ')}{s.members.length > 4 ? ` +${s.members.length - 4}` : ''}</span></div>
              ))}
              <div className="muted preset-meta">{p.theater.name} | {p.techMode}{p.excluded.length ? ` | excludes ${p.excluded.join(', ')}` : ''}</div>
            </div>
            <div className="row preset-actions">
              <button aria-label={`Load preset ${p.name}`} onClick={() => loadScenario(p, `Loaded preset: ${p.name}`)}>Load</button>
              <button className="primary" aria-label={`Run preset ${p.name}`} onClick={() => { void loadScenario(p, `Running preset: ${p.name}`).then(() => startRun(store.get().scenario, 3)); }}><Icon name="play" size={12} />Run</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
