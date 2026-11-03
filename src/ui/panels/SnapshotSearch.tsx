import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { yearLabel, type AppData } from '../data';
import { fmt } from '../format';
import { ERA_LABEL, REGION_LABEL, buildItems, searchSnapshots } from '../nationSearch';
import { KindBadge } from './SnapshotDetail';
import { showInNations } from './snapActions';
import '../../styles/setup.css';

const SHOWN = 8;

/** Type-ahead snapshot picker: the Nations tab's ranked search in a dropdown. Up/Down move,
 *  Enter picks, Esc closes. `taken` labels ids already used (for example "Side A"). */
export function SnapshotSearch({ data, onPick, placeholder, taken }: {
  data: AppData;
  onPick: (id: string) => void;
  placeholder: string;
  taken?: (id: string) => string | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const items = useMemo(() => buildItems(data), [data]);
  const res = useMemo(() => (q.trim() ? searchSnapshots(items, q) : []), [items, q]);
  const shown = res.slice(0, SHOWN);
  const show = open && q.trim().length > 0;

  const pick = (id: string) => { onPick(id); setQ(''); setActive(0); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && show && shown[active]) { e.preventDefault(); pick(shown[active].item.id); }
    else if (e.key === 'Escape') { if (show) { e.preventDefault(); setOpen(false); } else if (q) { e.preventDefault(); setQ(''); } }
  };

  return (
    <div className="cb">
      <input
        type="search" value={q} placeholder={placeholder} aria-label={placeholder}
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={show && shown[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
      />
      {show && (
        <ul className="cb-pop" id={listId} role="listbox">
          {shown.length === 0 && <li className="cb-empty">No snapshot matches. Try another name, a tag or a year (1805, 480 bce).</li>}
          {shown.map(({ item: s }, i) => {
            const t = taken?.(s.id) ?? null;
            return (
              <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className={`cb-opt kind-${s.kind}${i === active ? ' active' : ''}${t ? ' taken' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(s.id)}>
                <div className="nb-l1"><span className="nb-name">{s.name}</span><span className="nb-year">{yearLabel(s.year)}</span>{t && <span className="nb-side">{t}</span>}</div>
                <div className="nb-l2 small">
                  <KindBadge kind={s.kind} grade={s.confidence} compact />
                  <span className="muted">{ERA_LABEL[s.era]} · {REGION_LABEL[s.region] ?? s.region}</span>
                  <span>pop <b>{fmt(s.population)}</b> active <b>{fmt(s.active)}</b></span>
                </div>
              </li>
            );
          })}
          {res.length > 0 && (
            <li className="cb-foot" onMouseDown={(e) => e.preventDefault()}>
              {res.length > SHOWN ? `${res.length - SHOWN} more. ` : ''}
              <button className="link" onClick={() => showInNations(q)}>Browse {res.length === 1 ? 'it' : `all ${res.length}`} with details in Nations</button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
