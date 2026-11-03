import { useEffect, useMemo, useState } from 'react';
import type { Est, Override, Snapshot } from '../../types/schema';
import { yearLabel, type AppData } from '../data';
import { GradeBadge, SourceLink } from '../Grade';
import { ensureSnapshots } from '../lazy';
import { fmt } from '../format';
import { engineUse } from '../engineUse';
import { kindOf, snapshotConfidence } from '../nationSearch';
import { deltaLabel, describeOverride, fieldLabel, overrideRow, type OverrideRow } from '../overrideDiff';
import { setScenario, store, toast, useStore } from '../store';
import { overrideValueProblem } from '../../engine/overridePath';
import { EmptyData } from './EmptyData';
import { KindBadge } from './SnapshotDetail';
import { SnapshotSearch } from './SnapshotSearch';
import '../../styles/setup.css';

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
      const p = path.join('.');
      out.push({ path: p, est: o, ...fieldLabel(p) });
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

/** Researched value, struck through, then the edited one and the change. */
function Change({ r }: { r: OverrideRow }) {
  const d = deltaLabel(r);
  const dir = r.base && r.ov.value > r.base.mid ? 'up' : r.base && r.ov.value < r.base.mid ? 'down' : '';
  return (
    <span className="ov-change">
      {r.base && <><span className="ov-from" title={`researched ${r.base.low} / ${r.base.mid} / ${r.base.high} (low / mid / high), grade ${r.base.grade}`}>{fmt(r.base.mid)}</span> {'->'} </>}
      <span className="ov-to">{fmt(r.ov.value)}</span>
      {d && <> <span className={`ov-delta ${dir}`}>{d}</span></>}
      {r.outOfRange && <span className="ov-out" title={`Outside the researched range ${fmt(r.base!.low)} to ${fmt(r.base!.high)}`}> out of range</span>}
    </span>
  );
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
        aria-label={`${f.label}${ov ? `, edited, researched value ${f.est.mid}` : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setTxt(shownCur); (e.target as HTMLInputElement).blur(); }
        }} />
      {ov && <div className="ed-diff"><span className="muted">researched</span> <Change r={overrideRow(ov, f.est)} /></div>}
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

/** Every edit in the scenario, across snapshots: what it was, what it is, by how much. */
function ChangeList({ data, overrides, current, onJump }: { data: AppData; overrides: Override[]; current: string | null; onJump: (id: string, label: string) => void }) {
  const rows = overrides.map((o) => describeOverride(o, data.snapById.get(o.snapshotId)));
  return (
    <div className="ov-summary">
      <h5>
        <span>Changes in this scenario ({rows.length})</span>
        <button className="link" title="Remove every edit from the scenario" onClick={() => {
          if (confirm(`Reset all ${rows.length} edited value${rows.length === 1 ? '' : 's'} to the researched values?`)) setScenario((s) => ({ ...s, overrides: [] }));
        }}>reset all</button>
      </h5>
      <ul className="ov-list">
        {rows.map((r) => {
          const s = data.snapById.get(r.ov.snapshotId);
          return (
            <li key={`${r.ov.snapshotId} ${r.ov.path}`} className={r.ov.snapshotId === current ? 'cur' : ''}>
              <span className="ov-where" title={`${r.ov.snapshotId} ${r.ov.path}`}>
                <button className="link" onClick={() => onJump(r.ov.snapshotId, r.label)}>
                  <b>{r.label}</b> <span className="muted">{s ? `${s.name} ${yearLabel(s.year)}` : r.ov.snapshotId}</span>
                </button>
                {!r.base && <span className="muted"> {s ? '(field not in this snapshot)' : '(not loaded)'}</span>}
              </span>
              <Change r={r} />
              <button className="x" title="Reset to the researched value" onClick={() => setOverride(r.ov.snapshotId, r.ov.path, null)}>x</button>
            </li>
          );
        })}
      </ul>
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
  // overrides loaded from a file or link may sit on Phase 3 snapshots whose era is not loaded yet
  const ovIds = useMemo(() => [...new Set(sc.overrides.map((o) => o.snapshotId))], [sc.overrides]);
  useEffect(() => { if (ovIds.some((id) => data?.phase3ById.has(id) && !data.snapById.has(id))) void ensureSnapshots(ovIds); }, [ovIds, data]);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (data.snapshots.length === 0) return <EmptyData what="snapshots to edit" file="snapshots.json" />;

  const members = sc.sides.flatMap((s) => s.members);
  const editedElsewhere = ovIds.filter((id) => !members.includes(id));
  const ovs = new Map(sc.overrides.filter((o) => o.snapshotId === snapId).map((o) => [o.path, o]));
  const q = filter.toLowerCase();
  const shown = fields.filter((f) => (!q || f.path.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) && (!onlyEdited || ovs.has(f.path + '.mid')));
  const groups = [...new Set(shown.map((f) => f.group))];
  const choose = (id: string) => { store.set({ editorSnapshot: id }); setFilter(''); };
  const label = (id: string) => { const s = data.snapById.get(id); const e = data.phase3ById.get(id); return s ? `${s.name} (${yearLabel(s.year)})` : e ? `${e.name} (${yearLabel(e.year)})` : id; };

  return (
    <div className="panel-body editor">
      <div className="ed-pick">
        <select value={snapId ?? ''} onChange={(e) => store.set({ editorSnapshot: e.target.value || null })} aria-label="Snapshot to edit">
          <option value="">{members.length ? 'Choose a snapshot of this scenario...' : 'No members yet: search below...'}</option>
          {members.length > 0 && <optgroup label="In this scenario">
            {members.map((id) => <option key={id} value={id}>{label(id)}{sc.overrides.some((o) => o.snapshotId === id) ? ', edited' : ''}</option>)}
          </optgroup>}
          {editedElsewhere.length > 0 && <optgroup label="Edited, not in a side">
            {editedElsewhere.map((id) => <option key={id} value={id}>{label(id)}</option>)}
          </optgroup>}
          {snapId && !members.includes(snapId) && !editedElsewhere.includes(snapId) && <option value={snapId}>{label(snapId)}</option>}
        </select>
        <SnapshotSearch data={data} placeholder="Find any snapshot to edit..." onPick={(id) => { choose(id); void ensureSnapshots([id]); }} />
      </div>
      {sc.overrides.length > 0 && <ChangeList data={data} overrides={sc.overrides} current={snapId} onJump={(id, l) => { store.set({ editorSnapshot: id }); setFilter(l); setOnlyEdited(false); }} />}
      {!snapId && <p className="muted">Every numeric field of a snapshot is editable here. Edits are stored in the scenario (and its share URL) as overrides; the researched value stays visible with its range, grade and source, and every change is listed above with the researched value it replaces. Fields tagged "not used by the engine" are researched context only; "partly used" fields matter only in the case their tooltip names.</p>}
      {snapId && !snap && <p className="muted">{p3 ? `Loading ${label(snapId)}...` : `Snapshot ${snapId} is not in the data.`}</p>}
      {snap && (
        <>
          <div className="ed-head">
            <b>{snap.name}, {yearLabel(snap.year)}</b> <KindBadge kind={kindOf(snap, !!p3)} grade={p3?.confidence ?? snapshotConfidence(snap).letter} />
            <span className="muted small"> {snap.id} | doctrine {snap.doctrineId}</span>
            {snap.notes && <details className="sd-notes small"><summary>Research notes</summary><p>{snap.notes}</p></details>}
          </div>
          <div className="row">
            <input type="search" placeholder="Filter fields" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="toggle"><input type="checkbox" checked={onlyEdited} onChange={(e) => setOnlyEdited(e.target.checked)} /> edited only</label>
            <button disabled={ovs.size === 0} onClick={() => setScenario((s) => ({ ...s, overrides: s.overrides.filter((o) => o.snapshotId !== snapId) }))}>Reset all ({ovs.size})</button>
          </div>
          {!members.includes(snap.id) && <div className="notice">This snapshot is not in the current scenario; edits are stored but only matter once it is added to a side.</div>}
          {shown.length === 0 && <p className="muted small">No field matches "{filter}"{onlyEdited ? ' among the edited ones' : ''}.</p>}
          {groups.map((g) => (
            <details key={g} open={g !== 'production' || !!q || onlyEdited}>
              <summary>{GROUP_LABEL[g] ?? g} <span className="muted">({shown.filter((f) => f.group === g).length}{(() => { const n = shown.filter((f) => f.group === g && ovs.has(f.path + '.mid')).length; return n ? `, ${n} edited` : ''; })()})</span></summary>
              {shown.filter((f) => f.group === g).map((f) => <EditCell key={f.path} f={f} snapId={snap.id} ov={ovs.get(f.path + '.mid')} />)}
            </details>
          ))}
        </>
      )}
    </div>
  );
}
