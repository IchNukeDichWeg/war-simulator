import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { EraId, Est, Grade, RegionId, Snapshot } from '../../types/schema';
import { ERA_SPANS } from '../../types/schema';
import { fmt } from '../format';
import { yearLabel } from '../data';
import { DerivedBadge, EstValue, GradeBadge } from '../Grade';
import {
  ERA_LABEL, REGION_LABEL, buildItems, kindCounts, searchSnapshots, type SearchFilters, type SnapKind,
} from '../nationSearch';
import { ROLE_LABEL, ROLE_ORDER } from '../roles';
import { store, useStore } from '../store';
import { EmptyData } from './EmptyData';
import { KindBadge, SIDE_LETTER, SnapshotDetail } from './SnapshotDetail';
import { addToSide, browser } from './snapActions';
import '../../styles/setup.css';
import '../../styles/nations.css';

// moved to nationSearch.ts / snapActions.ts; re-exported for existing imports
export { ERA_LABEL, REGION_LABEL } from '../nationSearch';
export { addMember } from './snapActions';

const PAGE = 60;
const GRADES: Grade[] = ['A', 'B', 'C', 'D'];

export function NationBrowser() {
  const data = useStore((s) => s.data);
  const compare = useStore((s) => s.compare);
  const members = useStore((s) => s.scenario.sides);
  const [q, setQ] = useState(browser.q);
  const [era, setEra] = useState<EraId | ''>(browser.era);
  const [region, setRegion] = useState<RegionId | ''>(browser.region);
  const [kind, setKind] = useState<SnapKind | ''>(browser.kind);
  const [minGrade, setMinGrade] = useState<Grade | ''>(browser.minGrade);
  const [openId, setOpenId] = useState<string | null>(browser.openId);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  // era, region, grade and kind filters fold away; open when one is already set
  const [showFilters, setShowFilters] = useState(!!(browser.era || browser.region || browser.kind || browser.minGrade));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // keep the search when the tab is switched away and back
  useEffect(() => { Object.assign(browser, { q, era, region, kind, minGrade, openId }); }, [q, era, region, kind, minGrade, openId]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => (data ? buildItems(data) : []), [data]);
  // typing stays responsive: a search over 1,234 items takes about 10 ms, the list renders after
  const dq = useDeferredValue(q);
  const filters: SearchFilters = { era, region, kind, minGrade };
  const list = useMemo(() => searchSnapshots(items, dq, filters), [items, dq, era, region, kind, minGrade]);
  const counts = useMemo(() => kindCounts(items, dq, filters), [items, dq, era, region, minGrade]);
  const unfiltered = useMemo(() => (list.length === 0 && (era || region || kind || minGrade) ? searchSnapshots(items, dq).length : 0), [list, items, dq, era, region, kind, minGrade]);

  // A new query or filter, and coming back to the tab, start at the top with the search box in
  // view. An open detail stays open only if it is on the first page: keeping one far down (Rome
  // at row ~900 of the A to Z list) used to scroll the panel 60,000 px past the search box.
  // Keyed on the query and filters, not on `list`: the list is rebuilt whenever the data changes
  // (a Phase 3 era loading after a derived row is opened), and that collapsed it to one page and
  // closed the detail the user had just opened. `ready` reruns it once when the data first arrives.
  const ready = !!data;
  const keyMoved = useRef(false);
  useEffect(() => {
    const i = openId ? list.findIndex((r) => r.item.id === openId) : -1;
    if (openId && (i < 0 || i >= PAGE)) setOpenId(null);
    setLimit(PAGE);
    setActive(i >= 0 && i < PAGE ? i : 0);
  }, [ready, dq, era, region, kind, minGrade]);
  // only arrow and page keys follow the highlight; a list change never scrolls
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (items.length === 0) return <EmptyData what="nation snapshots" file="snapshots.json" />;

  const sideOf = (id: string) => members.findIndex((s) => s.members.includes(id));
  const anyFilter = !!(era || region || kind || minGrade);
  const clearFilters = () => { setEra(''); setRegion(''); setKind(''); setMinGrade(''); };
  const toggle = (id: string) => setOpenId((o) => (o === id ? null : id));
  const move = (to: number) => {
    const i = Math.max(0, Math.min(list.length - 1, to));
    if (i >= limit) setLimit(i + PAGE);
    keyMoved.current = true;
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== inputRef.current && e.target !== listRef.current) return;
    const cur = list[active]?.item;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(active + 10); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(active - 10); }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); toggle(cur.id); }
    else if (e.altKey && (e.code === 'KeyA' || e.code === 'KeyB') && cur) { e.preventDefault(); addToSide(e.code === 'KeyA' ? 0 : 1, cur.id); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (openId) setOpenId(null);
      else if (q) setQ('');
      else if (anyFilter) clearFilters();
    }
  };

  const total = items.length;
  const kinds: [SnapKind | '', string, number][] = [
    ['', 'All', counts.researched + counts.auto + counts.derived],
    ['researched', 'Researched', counts.researched],
    ['auto', 'Auto', counts.auto],
    ['derived', 'Derived', counts.derived],
  ];

  const nOn = [era, region, kind, minGrade].filter(Boolean).length;
  return (
    <div className="panel-body nb" onKeyDown={onKey}>
      <div className="nb-filters">
        <input
          ref={inputRef} type="search" className="nb-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Find a nation: name, year, region or tag"
          role="combobox" aria-expanded="true" aria-controls="nb-list" aria-activedescendant={list[active] ? `nb-${list[active].item.id}` : undefined}
          aria-label="Search nation snapshots" aria-describedby="nb-keys"
        />
        <div className="nb-status small">
          <span>{list.length === total ? `${total.toLocaleString('en-US')} nation snapshots` : `${list.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}{q.trim() ? ', best match first' : ', A to Z'}</span>
          <span className="nb-status-btns">
            {(anyFilter || q) && <button className="link" onClick={() => { setQ(''); clearFilters(); inputRef.current?.focus(); }}>Clear</button>}
            <button className={`nb-ftoggle${nOn ? ' on' : ''}`} aria-expanded={showFilters} aria-controls="nb-fbox" onClick={() => setShowFilters((v) => !v)}>
              Filters{nOn ? ` (${nOn})` : ''}
            </button>
          </span>
        </div>
        <div id="nb-fbox" className="nb-fbox" hidden={!showFilters}>
          <div className="nb-row2">
            <select value={era} onChange={(e) => setEra(e.target.value as EraId | '')} aria-label="Era">
              <option value="">All eras</option>
              {(Object.keys(ERA_SPANS) as EraId[]).map((x) => <option key={x} value={x}>{ERA_LABEL[x]} ({yearLabel(ERA_SPANS[x][0])} to {yearLabel(Math.min(ERA_SPANS[x][1], 2026))})</option>)}
            </select>
            <select value={region} onChange={(e) => setRegion(e.target.value as RegionId | '')} aria-label="Region">
              <option value="">All regions</option>
              {(Object.keys(REGION_LABEL) as RegionId[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
            </select>
          </div>
          <select value={minGrade} onChange={(e) => setMinGrade(e.target.value as Grade | '')} aria-label="Minimum confidence" title="Overall confidence: the mean grade over every value of the snapshot">
            <option value="">Any confidence grade</option>
            {GRADES.slice(0, 3).map((g) => <option key={g} value={g}>{g === 'A' ? 'Grade A only' : `Grade ${g} or better`}</option>)}
          </select>
          <div className="nb-seg" role="radiogroup" aria-label="Data kind">
              {kinds.map(([k, l, n]) => (
                <button key={k || 'all'} role="radio" aria-checked={kind === k} className={`${kind === k ? 'on' : ''}${k ? ` seg-${k}` : ''}`} onClick={() => setKind(k)}
                  title={k === 'derived' ? 'Phase 3 derived: formula-based, low confidence, loaded per era on use' : k === 'auto' ? 'Auto-base 2026: World Bank figures plus regional analogues' : k === 'researched' ? 'Researched: every value cites a source' : 'Every kind'}>
                  {l} <span className="nb-n">{n}</span>
                </button>
              ))}
          </div>
        </div>
        <div id="nb-keys" className="nb-keys muted small" hidden={!showFilters}>Keys: Up/Down move, Enter opens, Alt+A / Alt+B add to side A / B, Esc clears</div>
      </div>

      {compare[0] && compare[1] && <Compare a={data.snapById.get(compare[0])} b={data.snapById.get(compare[1])} grade={(id) => data.phase3ById.get(id)?.confidence} />}

      {list.length === 0 ? (
        <div className="nb-empty">
          <p><b>No snapshot matches{q.trim() ? <> "{q.trim()}"</> : ''}{anyFilter ? ' with these filters' : ''}.</b></p>
          {unfiltered > 0 ? (
            <p>{unfiltered} snapshot{unfiltered === 1 ? ' matches' : 's match'} outside the filters. <button className="link" onClick={clearFilters}>Clear filters</button></p>
          ) : (
            <p className="muted small">Try fewer words, another name of the state (Prussia, Ottoman, USSR), a tag (nomadic, NATO, colonial), a region, or a year such as 1805, 480 bce or 1900-1950.</p>
          )}
        </div>
      ) : (
        <ul className="nb-list" id="nb-list" role="listbox" tabIndex={-1} ref={listRef} aria-label="Snapshots">
          {list.slice(0, limit).map(({ item: s }, i) => {
            const side = sideOf(s.id);
            const open = openId === s.id;
            return (
              <li key={s.id} id={`nb-${s.id}`} data-i={i} role="option" aria-selected={i === active} aria-expanded={open}
                className={`nb-item kind-${s.kind}${i === active ? ' active' : ''}${open ? ' open' : ''}${compare.includes(s.id) ? ' sel' : ''}`}>
                <div className="nb-line" onClick={() => { setActive(i); toggle(s.id); }}>
                  <div className="nb-main">
                    <div className="nb-l1">
                      <span className="nb-name" title={s.id}>{s.name}</span>
                      <span className="nb-year">{yearLabel(s.year)}</span>
                      {/* overall confidence; researched is the default kind, the others are named on line 3 */}
                      <span className="nb-grade" title="Overall confidence: the mean grade over every value"><GradeBadge g={s.confidence} /></span>
                    </div>
                    <div className="nb-l2 small muted">{ERA_LABEL[s.era]} · {REGION_LABEL[s.region] ?? s.region}</div>
                    <div className="nb-l2 small">
                      {s.kind !== 'researched' && <KindBadge kind={s.kind} grade={s.confidence} compact />}
                      <span title="Active military personnel (mid) and its grade">army <b>{fmt(s.active)}</b>{s.activeGrade && <> <GradeBadge g={s.activeGrade} /></>}</span>
                      <span title="Population (mid)" className="muted"><b>{fmt(s.population)}</b> people</span>
                      {side >= 0 && <span className="nb-side" style={{ borderColor: members[side].color, color: members[side].color }} title={`On side ${SIDE_LETTER[side]}: ${members[side].name}`}>side {SIDE_LETTER[side]}</span>}
                    </div>
                  </div>
                  {side < 0 && (
                    <div className="nb-actions" onClick={(e) => e.stopPropagation()}>
                      {([0, 1] as const).map((k) => (
                        <button key={k} style={{ borderLeftColor: members[k].color }} aria-label={`Add ${s.name} ${yearLabel(s.year)} to side ${SIDE_LETTER[k]}, ${members[k].name}`}
                          title={`Add to side ${SIDE_LETTER[k]}: ${members[k].name} (Alt+${SIDE_LETTER[k]})`} onClick={() => addToSide(k, s.id)}>+ {SIDE_LETTER[k]}</button>
                      ))}
                    </div>
                  )}
                </div>
                {open && <SnapshotDetail id={s.id} header={false} />}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > limit && <button className="more" onClick={() => setLimit(limit + 200)}>Show more ({list.length - limit} left)</button>}
    </div>
  );
}

type Row = [string, (s: Snapshot) => Est | undefined, string?];
const ROWS: Row[] = [
  ['Population', (s) => s.demography.population],
  ['Urbanization', (s) => s.demography.urbanization],
  ['Territory km2', (s) => s.territory.areaKm2],
  ['Active personnel', (s) => s.military.activePersonnel],
  ['Trained reserves', (s) => s.military.trainedReserves],
  ['Mobilizable', (s) => s.military.mobilizable],
  ['Command quality', (s) => s.military.commandQuality],
  ['Cohesion', (s) => s.military.cohesion],
  ['Morale', (s) => s.military.morale],
  ['GDP (2011 int$)', (s) => s.economy.gdp],
  ['GDP per capita', (s) => s.economy.gdpPerCapita],
  ['Military spend share', (s) => s.economy.milSpendShare],
  ['Supply range km', (s) => s.logistics.supplyRangeKm],
  ['Rail km', (s) => s.logistics.railKm],
  ['Merchant tonnage', (s) => s.logistics.merchantTonnage],
  ['Nuclear warheads', (s) => s.strategic.nuclearWarheads],
  ['Home defense', (s) => s.geography.homeDefense],
  ...(['weapons', 'armor', 'ships', 'fortification', 'logistics', 'communications', 'isr', 'air', 'cyber'] as const)
    .map((c): Row => [`Tech: ${c}`, (s) => s.tech[c]]),
  ...ROLE_ORDER.map((r): Row => [ROLE_LABEL[r], (s) => s.military.forces[r]?.count]),
];

function Compare({ a, b, grade }: { a?: Snapshot; b?: Snapshot; grade: (id: string) => Grade | undefined }) {
  if (!a || !b) return null;
  const ga = grade(a.id), gb = grade(b.id);
  return (
    <div className="compare">
      <div className="compare-head">
        <span><button className="x" title="Close the comparison" onClick={() => store.set({ compare: [null, null] })}>x close</button></span>
        <b>{a.name} {yearLabel(a.year)}{ga && <DerivedBadge grade={ga} />}</b>
        <b>{b.name} {yearLabel(b.year)}{gb && <DerivedBadge grade={gb} />}</b>
      </div>
      {ROWS.map(([label, get]) => {
        const ea = get(a), eb = get(b);
        if (!ea && !eb) return null;
        if ((ea?.mid ?? 0) === 0 && (eb?.mid ?? 0) === 0 && label !== 'Nuclear warheads') return null;
        const better = ea && eb ? (ea.mid > eb.mid ? 0 : eb.mid > ea.mid ? 1 : -1) : -1;
        return (
          <div className="compare-row" key={label}>
            <span className="muted">{label}</span>
            <span className={better === 0 ? 'hi' : ''}><EstValue e={ea} /></span>
            <span className={better === 1 ? 'hi' : ''}><EstValue e={eb} /></span>
          </div>
        );
      })}
      <div className="muted small">Higher value highlighted; that is not "better" for every row. Hover a value for range, source and note.</div>
      <div className="compare-row">
        <span className="muted">Doctrine</span><span>{a.doctrineId}</span><span>{b.doctrineId}</span>
      </div>
      <div className="small muted">Grades: <GradeBadge g="A" /> documented <GradeBadge g="B" /> scholarly range <GradeBadge g="C" /> reconstructed <GradeBadge g="D" /> educated guess.</div>
    </div>
  );
}
