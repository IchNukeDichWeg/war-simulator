import { useEffect, useMemo, useState } from 'react';
import type { Est, Override, Snapshot } from '../../types/schema';
import { yearLabel } from '../data';
import { DerivedBadge, GradeBadge, SourceLink } from '../Grade';
import { ensureSnapshots } from '../lazy';
import { fmt } from '../format';
import { engineUse } from '../engineUse';
import { setScenario, store, toast, useStore } from '../store';
import { overrideValueProblem } from '../../engine/overridePath';
import { EmptyData } from './EmptyData';

interface Field { path: string; est: Est; group: string; label: string }

function isEst(o: unknown): o is Est {
  return !!o && typeof o === 'object' && 'mid' in o && 'low' in o && 'high' in o && 'grade' in o;
}

const GROUP_LABEL: Record<string, string> = {
  territory: 'Territory', demography: 'Demography', military: 'Military', forces: 'Force composition',
  tech: 'Technology (0..10)', economy: 'Economy', production: 'War production / year', logistics: 'Logistics',
  strategic: 'Strategic assets', geography: 'Geography',
};

/** Every Est in a snapshot, with its dot path (the Override path minus ".mid"). */
export function collectFields(s: Snapshot): Field[] {
  const out: Field[] = [];
  const walk = (o: unknown, path: string[]) => {
    if (isEst(o)) {
      let group = path[0];
      if (path[1] === 'forces') group = 'forces';
      if (path[1] === 'production') group = 'production';
      const label = group === 'forces' || group === 'production' ? path.slice(2).join(' ') : path.slice(1).join(' ');
      out.push({ path: path.join('.'), est: o, group, label: label.replace(/_/g, ' ') });
      return;
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) walk(v, [...path, k]);
  };
  for (const k of ['territory', 'demography', 'military', 'tech', 'economy', 'logistics', 'strategic', 'geography'] as const) {
    walk((s as unknown as Record<string, unknown>)[k], [k]);
  }
  return out;
}

function setOverride(snapshotId: string, path: string, value: number | null) {
  setScenario((sc) => {
    const rest = sc.overrides.filter((o) => !(o.snapshotId === snapshotId && o.path === path));
    return { ...sc, overrides: value == null ? rest : [...rest, { snapshotId, path, value }] };
  });
}

function EditCell({ f, snapId, ov }: { f: Field; snapId: string; ov?: Override }) {
  const cur = ov ? ov.value : f.est.mid;
  const shownCur = String(Number(cur.toPrecision(8)));
  const [txt, setTxt] = useState(shownCur);
  useEffect(() => setTxt(shownCur), [shownCur]);
  const commit = () => {
    const v = parseFloat(txt);
    if (!Number.isFinite(v)) { setTxt(shownCur); return; }
    if (txt === shownCur) return;
    // same bound the share link and the engine apply: no negative or absurd counts (red team C2/C3)
    const bad = overrideValueProblem(f.path + '.mid', v);
    if (bad) { toast(bad); setTxt(shownCur); return; }
    setOverride(snapId, f.path + '.mid', v === f.est.mid ? null : v);
  };
  const out = ov && (ov.value < f.est.low || ov.value > f.est.high);
  const use = engineUse(f.path);
  return (
    <div className={`ed-row${ov ? ' edited' : ''}`}>
      <div className="ed-label" title={f.path}>{f.label}{ov && <span className="edited-tag">edited</span>}
        {use && <span className={use.used === false ? 'unused-tag' : 'partly-tag'} title={use.note}>{use.used === false ? 'not used by the engine' : 'partly used'}</span>}</div>
      <input className={out ? 'out' : ''} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <div className="ed-meta">
        <GradeBadge g={f.est.grade} />
        <span className="ed-range" title="researched low / mid / high">{fmt(f.est.low)} <b>{fmt(f.est.mid)}</b> {fmt(f.est.high)}</span>
        {ov && <button className="reset" title={`Reset to researched value ${f.est.mid}`} onClick={() => setOverride(snapId, f.path + '.mid', null)}>reset</button>}
      </div>
      <div className="ed-src small"><SourceLink src={f.est.source} />{f.est.note && <span className="muted"> {f.est.note}</span>}</div>
      {out && <div className="small warn">Outside the researched range; the run uses it anyway.</div>}
    </div>
  );
}

export function Editor() {
  const data = useStore((s) => s.data);
  const snapId = useStore((s) => s.editorSnapshot);
  const sc = useStore((s) => s.scenario);
  const [filter, setFilter] = useState('');
  const [onlyEdited, setOnlyEdited] = useState(false);
  const snap = snapId ? data?.snapById.get(snapId) : undefined;
  const fields = useMemo(() => (snap ? collectFields(snap) : []), [snap]);
  const p3 = snapId ? data?.phase3ById.get(snapId) : undefined;
  useEffect(() => { if (snapId && !snap && p3) void ensureSnapshots([snapId]); }, [snapId, snap, p3]);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (data.snapshots.length === 0) return <EmptyData what="snapshots to edit" file="snapshots.json" />;

  const members = sc.sides.flatMap((s) => s.members);
  const ovs = new Map(sc.overrides.filter((o) => o.snapshotId === snapId).map((o) => [o.path, o]));
  const q = filter.toLowerCase();
  const shown = fields.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!onlyEdited || ovs.has(f.path + '.mid')));
  const groups = [...new Set(shown.map((f) => f.group))];

  return (
    <div className="panel-body editor">
      <select value={snapId ?? ''} onChange={(e) => store.set({ editorSnapshot: e.target.value || null })}>
        <option value="">Choose a snapshot...</option>
        {members.length > 0 && <optgroup label="In this scenario">
          {members.map((id) => { const s = data.snapById.get(id); return s ? <option key={id} value={id}>{s.name} ({yearLabel(s.year)})</option> : null; })}
        </optgroup>}
        <optgroup label="All snapshots">
          {data.snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} ({yearLabel(s.year)}){data.phase3ById.has(s.id) ? `, Phase 3 derived, confidence ${data.phase3ById.get(s.id)!.confidence}` : ''}</option>)}
        </optgroup>
      </select>
      {!snap && <p className="muted">Every numeric field of a snapshot is editable here. Edits are stored in the scenario (and its share URL) as overrides; the researched value stays visible with its range, grade and source. Fields tagged "not used by the engine" are researched context only; "partly used" fields matter only in the case their tooltip names.</p>}
      {snap && (
        <>
          <div className="ed-head">
            <b>{snap.name}, {yearLabel(snap.year)}</b>{p3 && <DerivedBadge grade={p3.confidence} />}
            <span className="muted small"> {snap.id} | doctrine {snap.doctrineId}</span>
            {snap.notes && <p className="small muted">{snap.notes}</p>}
          </div>
          <div className="row">
            <input type="search" placeholder="Filter fields" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="toggle"><input type="checkbox" checked={onlyEdited} onChange={(e) => setOnlyEdited(e.target.checked)} /> edited only</label>
            <button disabled={ovs.size === 0} onClick={() => setScenario((s) => ({ ...s, overrides: s.overrides.filter((o) => o.snapshotId !== snapId) }))}>Reset all ({ovs.size})</button>
          </div>
          {!members.includes(snap.id) && <div className="notice">This snapshot is not in the current scenario; edits are stored but only matter once it is added to a side.</div>}
          {groups.map((g) => (
            <details key={g} open={g !== 'production'}>
              <summary>{GROUP_LABEL[g] ?? g} <span className="muted">({shown.filter((f) => f.group === g).length})</span></summary>
              {shown.filter((f) => f.group === g).map((f) => <EditCell key={f.path} f={f} snapId={snap.id} ov={ovs.get(f.path + '.mid')} />)}
            </details>
          ))}
        </>
      )}
    </div>
  );
}
