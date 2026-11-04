import { useEffect, useState, type ReactNode } from 'react';
import type { Est, Grade } from '../../types/schema';
import { yearLabel } from '../data';
import { fmt, pct } from '../format';
import { GradeBadge } from '../Grade';
import { ensureSnapshots } from '../lazy';
import { ERA_LABEL, KIND_LABEL, REGION_LABEL, kindOf, snapshotConfidence, type SnapKind } from '../nationSearch';
import { forceMix, keyNumbers, snapshotSources, type KeyRow, type SourceRef } from '../snapshotFacts';
import { useStore } from '../store';
import { addToSide, openInEditor, removeMember, setCompare } from './snapActions';
import '../../styles/setup.css';
import '../../styles/nations.css';

const KIND_TITLE: Record<SnapKind, string> = {
  researched: 'Researched snapshot: every value carries its own source (data/RESEARCH_BRIEF.md).',
  auto: 'Auto-base snapshot (2026): population, economy, personnel and infrastructure from the World Bank (grade A/B); force mix, ratings and tech copied from researched regional analogues.',
  derived: 'Phase 3 derived snapshot, not researched: every value is a formula over its border polygon and regional inputs (data/SOURCES.md, "Phase 3 derivation inputs").',
};
const SHORT: Record<SnapKind, string> = { researched: 'Researched', auto: 'Auto-base', derived: 'Derived' };
export const SIDE_LETTER = ['A', 'B'] as const;

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

interface Fact { label: string; value: ReactNode; est?: Est; title?: string; wide?: boolean }

/** The few numbers a newcomer compares, in plain words, each with its grade. */
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="sd-facts">
      {facts.map((f) => (
        <div key={f.label} className={f.wide ? 'wide' : ''} title={f.title ?? (f.est ? `range ${fmt(f.est.low)} to ${fmt(f.est.high)}\nsource: ${f.est.source}` : undefined)}>
          <dt>{f.label}</dt>
          <dd>{f.value}{f.est && <> <GradeBadge g={f.est.grade} /></>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Add to side A or B; once on a side, say which and offer to take it off again. */
function SideButtons({ id }: { id: string }) {
  const sides = useStore((s) => s.scenario.sides);
  const side = sides.findIndex((s) => s.members.includes(id));
  if (side >= 0) {
    return (
      <div className="sd-onside">
        <span>On side {SIDE_LETTER[side]}: <b style={{ color: sides[side].color }}>{sides[side].name}</b></span>
        <button onClick={() => removeMember(id)}>Remove from side</button>
      </div>
    );
  }
  return (
    <div className="sd-add">
      {([0, 1] as const).map((i) => (
        <button key={i} className="sd-add-btn" style={{ borderLeftColor: sides[i].color }} onClick={() => addToSide(i, id)} title={`Add to side ${SIDE_LETTER[i]} (Alt+${SIDE_LETTER[i]} in the list)`}>
          <span>Add to side {SIDE_LETTER[i]}</span>
          <span className="sd-add-name">{sides[i].name}</span>
        </button>
      ))}
    </div>
  );
}

/** Everything a user needs to judge a snapshot before picking it: the key numbers in plain
 *  words, the side buttons, and under "Details" the ranges, force mix, sources and research
 *  notes. Phase 3 entries load their era file on open. */
export function SnapshotDetail({ id, header = true }: { id: string; header?: boolean }) {
  const data = useStore((s) => s.data);
  const compare = useStore((s) => s.compare);
  const snap = data?.snapById.get(id);
  const p3 = data?.phase3ById.get(id);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!snap && p3) ensureSnapshots([id]).then((ok) => setFailed(!ok));
  }, [id, snap, p3]);
  if (!data) return null;
  const more = (
    <div className="sd-actions small">
      <button className={compare[0] === id ? 'on' : ''} aria-pressed={compare[0] === id} onClick={() => setCompare(0, id)} title="Put this nation in the first column of the side-by-side comparison">Compare as 1st</button>
      <button className={compare[1] === id ? 'on' : ''} aria-pressed={compare[1] === id} onClick={() => setCompare(1, id)} title="Put this nation in the second column of the side-by-side comparison">Compare as 2nd</button>
      <button onClick={() => openInEditor(id)} title="Change this nation's numbers for this scenario only">Edit values</button>
    </div>
  );
  if (!snap) {
    if (!p3) return <div className="sd muted small">Unknown snapshot {id}.</div>;
    return (
      <div className="sd">
        <div className="small">{failed ? <span className="warn">The {ERA_LABEL[p3.era]} file could not be loaded; only the index figures are known.</span> : <span className="muted">Loading the {ERA_LABEL[p3.era]} Phase 3 file...</span>}</div>
        <Facts facts={[
          { label: 'Army (active)', value: fmt(p3.active), title: 'Index figure' },
          { label: 'Population', value: fmt(p3.population), title: 'Index figure' },
          { label: 'Era', value: `${ERA_LABEL[p3.era]}, ${yearLabel(p3.year)}`, wide: true },
        ]} />
        <SideButtons id={id} />
        {more}
      </div>
    );
  }
  const kind = kindOf(snap, !!p3);
  const conf = snapshotConfidence(snap);
  const grade = p3?.confidence ?? conf.letter;
  const forces = forceMix(snap);
  const doctrine = data.doctrines.find((d) => d.id === snap.doctrineId);
  const tags = snap.tags.filter((t) => t !== 'phase3' && t !== 'derived' && t !== 'auto-base');
  // optional chaining like keyNumbers: a hand-written snapshot may lack a section
  const army = snap.military?.activePersonnel;
  const population = snap.demography?.population;
  const gdp = snap.economy?.gdp;
  const tech = snap.tech?.weapons;
  const facts: Fact[] = [
    ...(army ? [{ label: 'Army (active)', value: count(army.mid), est: army }] : []),
    ...(population ? [{ label: 'Population', value: count(population.mid), est: population }] : []),
    ...(gdp ? [{ label: 'Economy (GDP)', value: `$${fmt(gdp.mid)}`, est: gdp, title: `Yearly output in 2011 international dollars, range $${fmt(gdp.low)} to $${fmt(gdp.high)}\nsource: ${gdp.source}` }] : []),
    ...(tech ? [{ label: 'Tech level', value: <>{tech.mid.toFixed(1)} <span className="muted">of 10</span></>, est: tech, title: `Weapons technology on the engine's 0 to 10 scale, range ${tech.low} to ${tech.high}` }] : []),
    { label: 'Era', value: `${ERA_LABEL[snap.era]}, ${yearLabel(snap.year)}, ${REGION_LABEL[snap.region] ?? snap.region}`, wide: true },
  ];
  return (
    <div className={`sd kind-${kind}`}>
      {header && (
        <div className="sd-head">
          <div><b>{snap.name}</b> <span className="muted">{yearLabel(snap.year)}</span></div>
          <KindBadge kind={kind} grade={grade} />
        </div>
      )}
      {kind === 'derived' && <div className="sd-warn small">Not researched. Each number is a formula over the border polygon and regional medians, so treat it as an order of magnitude.</div>}
      {kind === 'auto' && <div className="sd-warn auto small">Generated base: World Bank figures for people and money; forces, ratings and tech borrowed from researched neighbours.</div>}
      <Facts facts={facts} />
      <SideButtons id={id} />
      {more}
      <details className="sd-more">
        <summary>Details: ranges, forces, sources</summary>
        <div className="sd-more-body">
          <div className="small muted">{snap.phase} phase · capital {snap.capital?.name || 'unknown'}</div>
          {tags.length > 0 && <div className="sd-tags">{tags.slice(0, 10).map((t) => <span key={t} className="sd-tag">{t}</span>)}</div>}
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
        </div>
      </details>
    </div>
  );
}
