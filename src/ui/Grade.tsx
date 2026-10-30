import type { Est, Grade } from '../types/schema';
import { fmt, isUrl } from './format';

const GRADE_TEXT: Record<Grade, string> = {
  A: 'A: documented or officially reported',
  B: 'B: scholarly estimate with a range',
  C: 'C: reconstructed from analogies or indirect evidence',
  D: 'D: educated guess, flagged as such',
};

export function GradeBadge({ g }: { g: Grade | 'M' }) {
  const title = g === 'M' ? 'M: model output (simulation result, not data)' : GRADE_TEXT[g];
  return <span className={`grade grade-${g}`} title={title}>{g}</span>;
}

export function SourceLink({ src }: { src: string }) {
  if (!src) return <span className="muted">no source</span>;
  if (isUrl(src)) {
    let host = src;
    try { host = new URL(src).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
    return <a href={src} target="_blank" rel="noopener noreferrer" className="src" title={src}>{host}</a>;
  }
  if (src.startsWith('doi:')) return <a href={`https://doi.org/${src.slice(4)}`} target="_blank" rel="noopener noreferrer" className="src">{src}</a>;
  return <span className="src" title={src}>{src}</span>;
}

/** Compact value with grade badge and range in the tooltip. */
export function EstValue({ e, unit = '', value }: { e: Est | undefined; unit?: string; value?: number }) {
  if (!e) return <span className="muted">n/a</span>;
  const v = value ?? e.mid;
  const edited = value != null && value !== e.mid;
  return (
    <span className={`estv${edited ? ' edited' : ''}`} title={`range ${fmt(e.low)} to ${fmt(e.high)}${unit}\nsource: ${e.source}\n${e.note}`}>
      {fmt(v)}{unit} <GradeBadge g={e.grade} />
    </span>
  );
}

/** Label every Phase 3 derived snapshot carries wherever it is listed or shown. */
export function DerivedBadge({ grade }: { grade: Grade }) {
  return (
    <span className="derived-badge" title={`Phase 3 derived snapshot, not researched: every value is a formula over its border polygon and regional inputs (data/SOURCES.md, "Phase 3 derivation inputs"). Overall confidence ${GRADE_TEXT[grade]}.`}>
      Phase 3 derived <GradeBadge g={grade} />
    </span>
  );
}
