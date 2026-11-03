import { useMemo, useState } from 'react';
import type { Scenario, SideSpec, TechMode } from '../../types/scenario';
import { yearLabel, yearOf, type AppData } from '../data';
import { ensureSnapshots } from '../lazy';
import { buildItems, type SearchItem } from '../nationSearch';
import { runMonteCarlo, scenarioProblems, startRun } from '../engine';
import { THEATERS, type BBox } from '../scenarioDefaults';
import { setScenario, store, toast, useStore } from '../store';
import { KindBadge } from './SnapshotDetail';
import { SnapshotSearch } from './SnapshotSearch';
import { showInNations } from './snapActions';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Fallback anchor labels from data/SOURCES.md when mechanics.json has no techLevels yet. */
const TECH_ANCHORS = ['before 3000 BCE', '2500 BCE', '1400 BCE', '300 BCE', '1250', '1600', '1805', '1905', '1943', '1985', '2026'];

function updSide(i: 0 | 1, f: (s: SideSpec) => SideSpec) {
  setScenario((sc) => {
    const sides = [...sc.sides] as Scenario['sides'];
    sides[i] = f(sides[i]);
    return { ...sc, sides };
  });
}

function SideEditor({ i, data, sc, itemById }: { i: 0 | 1; data: AppData; sc: Scenario; itemById: Map<string, SearchItem> }) {
  const side = sc.sides[i];
  const mapMode = useStore((s) => s.mapMode);
  const [year, setYear] = useState('');
  const placing = mapMode.kind === 'start' && mapMode.side === i;
  // Phase 3 ids load their era first; the check reads the store, not the (older) props.
  const addIds = (ids: string[]) => ensureSnapshots(ids).then(() => updSide(i, (s) => {
    const taken = new Set(store.get().scenario.sides.flatMap((x) => x.members));
    const known = store.get().data?.snapById ?? data.snapById;
    return { ...s, members: [...s.members, ...ids.filter((id) => !taken.has(id) && known.has(id))] };
  }));
  const snapToYear = () => {
    const y = parseInt(year, 10);
    if (!Number.isFinite(y)) { toast('Enter a year (negative for BCE).'); return; }
    updSide(i, (s) => ({
      ...s,
      members: s.members.map((id) => {
        const snap = data.snapById.get(id);
        const nat = snap && data.nationById.get(snap.nationId);
        if (!nat) return id;
        let best = id, bd = Infinity;
        for (const sid of nat.snapshotIds) {
          const oy = yearOf(data, sid);
          if (oy != null && Math.abs(oy - y) < bd) { bd = Math.abs(oy - y); best = sid; }
        }
        return best;
      }),
    }));
    void ensureSnapshots(store.get().scenario.sides[i].members);
  };
  return (
    <fieldset className="side" style={{ borderColor: side.color }}>
      <legend>
        <input className="side-name" value={side.name} onChange={(e) => updSide(i, (s) => ({ ...s, name: e.target.value }))} />
        <input type="color" value={side.color} onChange={(e) => updSide(i, (s) => ({ ...s, color: e.target.value }))} title="Side colour" />
      </legend>
      {side.members.length === 0 && <div className="muted small">No members yet. Add snapshots below or from the Nations tab.</div>}
      <ul className="members">
        {side.members.map((id) => {
          const s = data.snapById.get(id);
          const nat = s ? data.nationById.get(s.nationId) : undefined;
          const excluded = s && (sc.excluded.includes(s.nationId));
          const it = itemById.get(id);
          return (
            <li key={id} className={excluded ? 'excluded' : ''}>
              <span className="member-name" title={id}>{s
                ? <button className="link member-link" title="Show the key numbers and sources in the Nations tab" onClick={() => showInNations(`${s.name} ${yearLabel(s.year)}`, id)}>{s.name}</button>
                : data.phase3ById.has(id) ? <span className="muted">loading {id}...</span> : <span className="warn">unknown: {id}</span>}</span>
              {/* researched is the default; auto-base and derived members are flagged */}
              {it && it.kind !== 'researched' && <KindBadge kind={it.kind} grade={it.confidence} compact />}
              {nat && nat.snapshotIds.length > 1 ? (
                <select title="Time-slice: pick another year of this nation (derived = Phase 3, low confidence)" value={id} onChange={(e) => { const v = e.target.value; ensureSnapshots([v]).then(() => updSide(i, (x) => ({ ...x, members: x.members.map((m) => (m === id ? v : m)) }))); }}>
                  {nat.snapshotIds.map((sid) => { const oy = yearOf(data, sid); return <option key={sid} value={sid}>{oy != null ? yearLabel(oy) : sid}{data.phase3ById.has(sid) ? ' derived' : ''}</option>; })}
                </select>
              ) : s ? <span className="muted">{yearLabel(s.year)}</span> : null}
              <button className="x" title="Remove" onClick={() => updSide(i, (x) => ({ ...x, members: x.members.filter((m) => m !== id) }))}>x</button>
            </li>
          );
        })}
      </ul>
      <SnapshotSearch data={data} placeholder="Add a nation: name, tag or year..." onPick={(id) => addIds([id])}
        taken={(id) => { const k = sc.sides.findIndex((x) => x.members.includes(id)); return k >= 0 ? sc.sides[k].name : null; }} />
      {data.coalitions.length > 0 && (
        <select value="" onChange={(e) => { const c = data.coalitions.find((x) => x.id === e.target.value); if (c) addIds(c.members); }}>
          <option value="">Add coalition preset...</option>
          {data.coalitions.map((c) => <option key={c.id} value={c.id}>{c.name} ({yearLabel(c.year)}, {c.members.length})</option>)}
        </select>
      )}
      <div className="row">
        <input className="narrow" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} />
        <button onClick={snapToYear} title="Swap every member to its snapshot nearest this year (time-slice)">Set side year</button>
      </div>
      <div className="row">
        <button className={placing ? 'on' : ''} onClick={() => store.set({ mapMode: placing ? { kind: 'none' } : { kind: 'start', side: i } })}>
          {placing ? 'Done placing' : 'Place start points'}
        </button>
        {(side.startPositions?.length ?? 0) > 0 && (
          <button onClick={() => updSide(i, (s) => ({ ...s, startPositions: undefined }))}>Clear {side.startPositions!.length}</button>
        )}
        <span className="muted small">{side.startPositions?.length ? '' : 'default: own cities / nearest edge'}</span>
      </div>
    </fieldset>
  );
}

function ExcludedEditor({ data, sc }: { data: AppData; sc: Scenario }) {
  const [v, setV] = useState('');
  return (
    <div>
      <div className="chips">
        {sc.excluded.length === 0 && <span className="muted small">None. Excluded nations are removed everywhere, including from empires and alliances that include them.</span>}
        {sc.excluded.map((n) => (
          <span key={n} className="chip">{data.nationById.get(n)?.name ?? n}
            <button className="x" onClick={() => setScenario((s) => ({ ...s, excluded: s.excluded.filter((x) => x !== n) }))}>x</button>
          </span>
        ))}
      </div>
      <input list="nations-dl" value={v} placeholder="Exclude a nation..." onChange={(e) => {
        const m = e.target.value.match(/\[([^\]]+)\]$/);
        if (m && data.nationById.has(m[1])) {
          const id = m[1];
          setScenario((s) => (s.excluded.includes(id) ? s : { ...s, excluded: [...s.excluded, id] }));
          setV('');
        } else setV(e.target.value);
      }} />
      <datalist id="nations-dl">{data.nations.map((n) => <option key={n.id} value={`${n.name} [${n.id}]`} />)}</datalist>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function ScenarioBuilder() {
  const data = useStore((s) => s.data);
  const sc = useStore((s) => s.scenario);
  const mapMode = useStore((s) => s.mapMode);
  const runStatus = useStore((s) => s.run.status);
  const [mcRuns, setMcRuns] = useState(100);
  const itemById = useMemo(() => new Map(data ? buildItems(data).map((x) => [x.id, x]) : []), [data]);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  const problems = scenarioProblems(sc);
  const anchors = data.mechanics?.techLevels?.length ? data.mechanics.techLevels.map((t) => t.label) : TECH_ANCHORS;
  const setBBox = (b: BBox, name: string) => setScenario((s) => ({ ...s, theater: { name, bbox: b } }));
  const drawing = mapMode.kind === 'bbox';

  return (
    <div className="panel-body scenario">
      <div className="field">
        <input className="title-input" value={sc.name} onChange={(e) => setScenario((s) => ({ ...s, name: e.target.value }))} />
        <textarea rows={2} placeholder="Description" value={sc.description} onChange={(e) => setScenario((s) => ({ ...s, description: e.target.value }))} />
      </div>

      {data.snapshots.length === 0 && <div className="notice">No nation data loaded yet; sides cannot be filled until <code>snapshots.json</code> exists.</div>}
      <SideEditor i={0} data={data} sc={sc} itemById={itemById} />
      <SideEditor i={1} data={data} sc={sc} itemById={itemById} />

      <h4>Excluded nations</h4>
      <ExcludedEditor data={data} sc={sc} />

      <h4>Theater: {sc.theater.name}</h4>
      <div className="chips">
        {THEATERS.map((t) => (
          <button key={t.name} className={sc.theater.name === t.name ? 'on' : ''} onClick={() => setBBox([...t.bbox] as BBox, t.name)}>{t.name}</button>
        ))}
        <button className={drawing ? 'on' : ''} onClick={() => store.set({ mapMode: drawing ? { kind: 'none' } : { kind: 'bbox' } })}>
          {drawing ? 'Click two corners (Esc)' : 'Draw on map'}
        </button>
      </div>
      <div className="bbox">
        {(['W', 'S', 'E', 'N'] as const).map((k, j) => (
          <label key={k}>{k}
            <input type="number" step={0.25} value={sc.theater.bbox[j]} onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isFinite(v)) return;
              const b = [...sc.theater.bbox] as BBox;
              b[j] = v;
              setBBox(b, 'Custom');
            }} />
          </label>
        ))}
      </div>

      <div className="row">
        <label>Start month
          <select value={sc.startMonth} onChange={(e) => setScenario((s) => ({ ...s, startMonth: +e.target.value }))}>
            {MONTHS.map((m, j) => <option key={m} value={j + 1}>{m}</option>)}
          </select>
        </label>
        <label>Seed
          <input className="narrow" type="number" value={sc.seed} onChange={(e) => setScenario((s) => ({ ...s, seed: Math.trunc(+e.target.value) || 0 }))} />
        </label>
        <button onClick={() => setScenario((s) => ({ ...s, seed: Math.floor(Math.random() * 2 ** 31) }))}>Random</button>
      </div>

      <h4>Technology</h4>
      <div className="radio-row">
        {([['native', 'Native (own era)'], ['equalized', 'Era-equalized'], ['timeslice', 'Time-slice']] as [TechMode, string][]).map(([m, l]) => (
          <label key={m}><input type="radio" checked={sc.techMode === m} onChange={() => setScenario((s) => ({ ...s, techMode: m }))} /> {l}</label>
        ))}
      </div>
      {sc.techMode === 'equalized' && (
        <div className="field">
          <input type="range" min={0} max={10} step={0.5} value={sc.equalizedTech ?? 8} onChange={(e) => setScenario((s) => ({ ...s, equalizedTech: +e.target.value }))} />
          <div className="small">Both sides fight at tech {sc.equalizedTech ?? 8} ({anchors[Math.round(sc.equalizedTech ?? 8)] ?? ''}). Population, economy, geography and doctrine stay their own; roles that do not exist at that level are converted.</div>
        </div>
      )}
      {sc.techMode === 'timeslice' && <div className="small muted">Pick a year per member (dropdown next to each member) or per side with "Set side year".</div>}
      {sc.techMode === 'native' && <div className="small muted">Each side keeps its own era's technology, doctrine and logistics. Lopsided results are shown with their reasons.</div>}

      <h4>Rules</h4>
      <div className="toggles">
        {(['naval', 'air', 'weather', 'supply', 'fogOfWar'] as const).map((k) => (
          <Toggle key={k} label={k === 'fogOfWar' ? 'fog of war' : k} checked={sc.rules[k]} onChange={(v) => setScenario((s) => ({ ...s, rules: { ...s.rules, [k]: v } }))} />
        ))}
        <Toggle label="nuclear" checked={sc.rules.nuclear} hint="Off by default" onChange={(v) => {
          if (v && !confirm('Enable nuclear weapons?\n\nThe engine then uses the documented escalation model in ENGINE.md. Results of nuclear use are extremely uncertain and dominate every other factor.')) return;
          setScenario((s) => ({ ...s, rules: { ...s.rules, nuclear: v } }));
        }} />
      </div>
      {sc.rules.nuclear && <div className="notice warn">Nuclear use is ON. The escalation model is a documented simplification (ENGINE.md); treat any result as illustrative only.</div>}

      <h4>Victory conditions</h4>
      <div className="toggles">
        <Toggle label="capital captured" checked={sc.victory.capitalCaptured} onChange={(v) => setScenario((s) => ({ ...s, victory: { ...s.victory, capitalCaptured: v } }))} />
        <Toggle label="army collapse" checked={sc.victory.armyCollapse} onChange={(v) => setScenario((s) => ({ ...s, victory: { ...s.victory, armyCollapse: v } }))} />
      </div>
      <label className="field">Territory share held: {sc.victory.territoryShare === 0 ? 'off' : `${Math.round(sc.victory.territoryShare * 100)}%`}
        <input type="range" min={0} max={1} step={0.05} value={sc.victory.territoryShare} onChange={(e) => setScenario((s) => ({ ...s, victory: { ...s.victory, territoryShare: +e.target.value } }))} />
      </label>
      <label className="field">Time limit (days)
        <input type="number" min={1} max={36500} value={sc.victory.timeLimitDays} onChange={(e) => setScenario((s) => ({ ...s, victory: { ...s.victory, timeLimitDays: Math.max(1, Math.trunc(+e.target.value) || 1) } }))} />
      </label>

      {sc.overrides.length > 0 && <div className="notice">{sc.overrides.length} edited value{sc.overrides.length > 1 ? 's' : ''} in this scenario (Editor tab).</div>}
      {problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="row sticky-actions">
        <button className="primary" disabled={problems.length > 0 || runStatus === 'starting'} onClick={() => startRun(sc, 3)}>Run war</button>
        <input className="narrow" type="number" min={2} max={5000} value={mcRuns} onChange={(e) => setMcRuns(Math.max(2, Math.min(5000, Math.trunc(+e.target.value) || 2)))} title="Monte Carlo runs" />
        <button disabled={problems.length > 0} onClick={() => { runMonteCarlo(sc, mcRuns); store.set({ rightTab: 'montecarlo' }); }}>Monte Carlo x{mcRuns}</button>
      </div>
    </div>
  );
}
