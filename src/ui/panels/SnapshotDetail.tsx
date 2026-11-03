import { useEffect, useState } from 'react';
import type { Grade } from '../../types/schema';
import { yearLabel } from '../data';
import { fmt, pct } from '../format';
import { GradeBadge } from '../Grade';
import { ensureSnapshots } from '../lazy';
import { ERA_LABEL, KIND_LABEL, REGION_LABEL, kindOf, snapshotConfidence, type SnapKind } from '../nationSearch';
import { forceMix, keyNumbers, snapshotSources, type KeyRow, type SourceRef } from '../snapshotFacts';
import { useStore } from '../store';
import { addToSide, openInEditor, setCompare } from './snapActions';
import '../../styles/setup.css';

const KIND_TITLE: Record<SnapKind, string> = {
  researched: 'Researched snapshot: every value carries its own source (data/RESEARCH_BRIEF.md).',
  auto: 'Auto-base snapshot (2026): population, economy, personnel and infrastructure from the World Bank (grade A/B); force mix, ratings and tech copied from researched regional analogues.',
  derived: 'Phase 3 derived snapshot, not researched: every value is a formula over its border polygon and regional inputs (data/SOURCES.md, "Phase 3 derivation inputs").',
};
const SHORT: Record<SnapKind, string> = { researched: 'Researched', auto: 'Auto-base', derived: 'Derived' };

/** Where a snapshot's numbers come from, with its overall grade. Shown on every row and in
 *  the detail, so researched and derived data are never confused. */
export function KindBadge({ kind, grade, compact }: { kind: SnapKind; grade: Grade; compact?: boolean }) {
  return (
    <span className={`kind-badge kind-${kind}`} title={`${KIND_TITLE[kind]} Overall confidence ${grade} (mean grade over every value).`}>
      {compact ? SHORT[kind] : KIND_LABEL[kind]} <GradeBadge g={grade} />
    </span>
  );
}

function fmtUnit(v: number, unit: KeyRow['unit']): string {
  if (unit === 'pct') return pct(v);
  if (unit === 'tech') return v.toFixed(1);
  return count(v);
}

/** Whole counts below 100 stay whole ("67 submarines", not fmt's "67.0"). */
function count(v: number): string {
  return Number.isInteger(v) && Math.abs(v) < 100 ? String(v) : fmt(v);
}

function KeyTable({ rows }: { rows: KeyRow[] }) {
  return (
    <table className="sd-table">
      <thead><tr><th /><th>low</th><th>mid</th><th>high</th><th title="Confidence grade">gr.</th></tr></thead>
      <tbody>
        {rows.map(({ label, est, unit }) => (
          <tr key={label} title={`source: ${est.source}${est.note ? `\n${est.note}` : ''}`}>
            <th scope="row">{label}{unit === 'km2' ? ' km²' : unit === 'km' ? ' km' : ''}</th>
            <td>{fmtUnit(est.low, unit)}</td>
            <td className="sd-mid">{fmtUnit(est.mid, unit)}</td>
            <td>{fmtUnit(est.high, unit)}</td>
            <td><GradeBadge g={est.grade} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GradeBar({ counts, n }: { counts: Record<Grade, number>; n: number }) {
  return (
    <div className="sd-gradebar" role="img" aria-label={`Grades over ${n} values: ${(['A', 'B', 'C', 'D'] as Grade[]).map((g) => `${g} ${counts[g]}`).join(', ')}`}>
      {(['A', 'B', 'C', 'D'] as Grade[]).map((g) => counts[g] > 0 && (
        <span key={g} className={`grade-${g}`} style={{ flexGrow: counts[g] }} title={`${counts[g]} value${counts[g] === 1 ? '' : 's'} graded ${g}`} />
      ))}
    </div>
  );
}

function Sources({ refs }: { refs: SourceRef[] }) {
  const [all, setAll] = useState(false);
  const works = refs.filter((r) => r.href);
  const methods = refs.filter((r) => !r.href);
  const shown = all ? works : works.slice(0, 6);
  const tip = (r: SourceRef) => `${r.source}\ncited by ${r.count} value${r.count === 1 ? '' : 's'}: ${r.fields.slice(0, 8).join(', ')}${r.fields.length > 8 ? ', ...' : ''}`;
  return (
    <div className="sd-sources">
      {works.length === 0 && <div className="muted small">No cited works: every value is derived by a documented method.</div>}
      <ul>
        {shown.map((r) => (
          <li key={r.source}>
            <a href={r.href} target="_blank" rel="noopener noreferrer" title={tip(r)}>{r.label}</a>
            <span className="muted"> {r.count}</span>
          </li>
        ))}
      </ul>
      {works.length > shown.length && <button className="link" onClick={() => setAll(true)}>{works.length - shown.length} more sources</button>}
      {methods.length > 0 && (
        <div className="small muted sd-methods" title="Derivation methods are documented in data/SOURCES.md">
          Methods: {methods.map((r, i) => <span key={r.source} title={tip(r)}>{i > 0 ? ', ' : ''}{r.label} ({r.count})</span>)}
        </div>
      )}
    </div>
  );
}

/** Everything a user needs to judge a snapshot before picking it: key numbers with their
 *  ranges and grades, force mix, sources as links and the research notes. Phase 3 entries
 *  load their era file on open. */
export function SnapshotDetail({ id, header = true }: { id: string; header?: boolean }) {
  const data = useStore((s) => s.data);
  const compare = useStore((s) => s.compare);
  const sides = useStore((s) => s.scenario.sides);
  const snap = data?.snapById.get(id);
  const p3 = data?.phase3ById.get(id);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!snap && p3) ensureSnapshots([id]).then((ok) => setFailed(!ok));
  }, [id, snap, p3]);
  if (!data) return null;
  const side = sides.findIndex((s) => s.members.includes(id));
  const actions = (
    <div className="sd-actions">
      <button onClick={() => addToSide(0, id)} disabled={side >= 0} title={side >= 0 ? `Already on ${sides[side].name}` : `Add to ${sides[0].name}`}>+ {sides[0].name}</button>
      <button onClick={() => addToSide(1, id)} disabled={side >= 0} title={side >= 0 ? `Already on ${sides[side].name}` : `Add to ${sides[1].name}`}>+ {sides[1].name}</button>
      <button className={compare[0] === id ? 'on' : ''} onClick={() => setCompare(0, id)} title="Compare slot 1">C1</button>
      <button className={compare[1] === id ? 'on' : ''} onClick={() => setCompare(1, id)} title="Compare slot 2">C2</button>
      <button onClick={() => openInEditor(id)} title="Edit values for this scenario">Edit</button>
    </div>
  );
  if (!snap) {
    if (!p3) return <div className="sd muted small">Unknown snapshot {id}.</div>;
    return (
      <div className="sd">
        <div className="small">{failed ? <span className="warn">The {ERA_LABEL[p3.era]} file could not be loaded; only the index figures are known.</span> : <span className="muted">Loading the {ERA_LABEL[p3.era]} Phase 3 file...</span>}</div>
        <div className="small">population {fmt(p3.population)}, active {fmt(p3.active)} (index figures)</div>
        {actions}
      </div>
    );
  }
  const kind = kindOf(snap, !!p3);
  const conf = snapshotConfidence(snap);
  const grade = p3?.confidence ?? conf.letter;
  const forces = forceMix(snap);
  const doctrine = data.doctrines.find((d) => d.id === snap.doctrineId);
  const tags = snap.tags.filter((t) => t !== 'phase3' && t !== 'derived' && t !== 'auto-base');
  return (
    <div className={`sd kind-${kind}`}>
      {header && (
        <div className="sd-head">
          <div><b>{snap.name}</b> <span className="muted">{yearLabel(snap.year)}</span></div>
          <KindBadge kind={kind} grade={grade} />
        </div>
      )}
      <div className="small muted">{header ? `${ERA_LABEL[snap.era]} · ${REGION_LABEL[snap.region] ?? snap.region} · ` : ''}{snap.phase} phase · capital {snap.capital?.name || 'unknown'}</div>
      {tags.length > 0 && <div className="sd-tags">{tags.slice(0, 10).map((t) => <span key={t} className="sd-tag">{t}</span>)}</div>}
      {kind === 'derived' && <div className="sd-warn small">Not researched. Each number is a formula over the border polygon and regional medians, so treat it as an order of magnitude.</div>}
      {kind === 'auto' && <div className="sd-warn auto small">Generated base: World Bank figures for people and money; forces, ratings and tech borrowed from researched neighbours.</div>}
      <div className="sd-conf small">
        <span>Confidence <GradeBadge g={grade} /> over {conf.n} values</span>
        <GradeBar counts={conf.counts} n={conf.n} />
      </div>
      <KeyTable rows={keyNumbers(snap)} />
      {forces.length > 0 && (
        <div className="sd-forces small">
          {forces.map((f) => <span key={f.role} title={`${fmt(f.count.low)} to ${fmt(f.count.high)}, source ${f.count.source}`}>{f.label} <b>{count(f.count.mid)}</b> <GradeBadge g={f.count.grade} /></span>)}
        </div>
      )}
      <div className="small sd-doctrine">Doctrine: {doctrine ? <>{doctrine.name} <GradeBadge g={doctrine.grade} /></> : <span className="muted">{snap.doctrineId}</span>}</div>
      <h5>Sources</h5>
      <Sources refs={snapshotSources(snap)} />
      {snap.notes && (
        <details className="sd-notes small">
          <summary>Research notes</summary>
          <p>{snap.notes}</p>
        </details>
      )}
      {actions}
    </div>
  );
}
