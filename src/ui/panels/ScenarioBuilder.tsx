import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { DEFAULT_RULES, DEFAULT_VICTORY, type Scenario, type SideSpec, type TechMode } from '../../types/scenario';
import { yearLabel, yearOf, type AppData } from '../data';
import { ensureSnapshots } from '../lazy';
import { buildItems, type SearchItem } from '../nationSearch';
import { runMonteCarlo, scenarioProblems, startRun } from '../engine';
import { MAX_SEED, MAX_TIME_LIMIT_DAYS, THEATERS, type BBox } from '../scenarioDefaults';
import { getSettings } from '../settings';
import { setScenario, store, toast, useStore } from '../store';
import { fitChoices } from '../theaterFit';
import { KindBadge } from './SnapshotDetail';
import { SnapshotSearch } from './SnapshotSearch';
import { showInNations } from './snapActions';
import '../../styles/builder.css';

// Layout: the two sides and the theater are always shown, then the Run area. Everything
// else sits in closed disclosure sections whose summary line names every non-default value,
// so a changed setting is never hidden silently.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Start month of a fresh scenario (scenarioDefaults); the Advanced summary reports any other. */
const DEFAULT_MONTH = 5;
/** Fallback anchor labels from data/SOURCES.md when mechanics.json has no techLevels yet. */
const TECH_ANCHORS = ['before 3000 BCE', '2500 BCE', '1400 BCE', '300 BCE', '1250', '1600', '1805', '1905', '1943', '1985', '2026'];
/** Monte Carlo run counts offered in the select; "Custom" opens a 2..5000 number box. */
const MC_CHOICES = [100, 500, 1000];
/** Plain labels for the three tech modes; the stored values stay native / equalized / timeslice. */
const TECH_MODES: [TechMode, string][] = [['native', "Each side's own era"], ['equalized', 'Same tech level for both'], ['timeslice', 'Pick a year per nation']];
/** Rule toggles other than nuclear (which asks first): key, label, hover hint. */
const RULES: [Exclude<keyof Scenario['rules'], 'nuclear'>, string, string][] = [
  ['naval', 'Naval combat', 'Fleets fight for sea control, blockade ports and carry supply by sea'],
  ['air', 'Air power', 'Fighters contest the sky; bombers support battles and cut supply'],
  ['weather', 'Weather', 'Mud and snow slow movement; the start month sets the season'],
  ['supply', 'Supply lines', 'Armies need food, fodder and fuel; cut-off armies weaken'],
  ['fogOfWar', 'Fog of war', 'Each side only sees enemies within scouting range'],
];
const SIDE_LETTER = ['A', 'B'] as const;
/** Theater box edges in the stored order [west, south, east, north]. */
const BOX_LABELS = ['West', 'South', 'East', 'North'] as const;

/** Which disclosure sections are open, per browser. Closed by default; storage may be blocked. */
const OPEN_KEY = 'mews.setup.open';
function readOpen(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch { return {}; }
}

/** A closed-by-default section. `summary` lists the non-default values; empty shows `idle`. */
function Section({ id, title, summary, warn, idle = 'defaults', children }: { id: string; title: string; summary: string[]; warn?: boolean; idle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen()[id] === true);
  return (
    <details className="sb-section" open={open} onToggle={(e) => {
      const o = e.currentTarget.open;
      if (o === open) return;
      setOpen(o);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: o })); } catch { /* private mode: not remembered */ }
    }}>
      <summary>
        <span className="sb-title">{title}</span>
        <span className={'sb-sum' + (summary.length ? ' changed' : '') + (warn ? ' warn' : '')}>{summary.length ? summary.join(', ') : idle}</span>
      </summary>
      <div className="sb-body">{children}</div>
    </details>
  );
}

/** A number box's text as a value clamped to [min, max] (rounded when `integer`), or null when
 *  it is not a number and the box goes back to the stored value. */
export function parseNumberText(text: string, min: number, max: number, integer = false): number | null {
  const t = text.trim();
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  const c = Math.min(max, Math.max(min, v));
  return integer ? Math.round(c) : c;
}

/** A number box that keeps its own text and commits on blur or Enter (Escape reverts), like the
 *  Editor's cells. Committing every keystroke through a clamp snapped a cleared box to its
 *  minimum (time limit 1, then typing 500 gave 1500) and left a leading zero in view ("07"). */
function NumberField({ value, min, max, integer, onCommit, ...rest }: { value: number; min: number; max: number; integer?: boolean; onCommit: (v: number) => void }
  & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'min' | 'max' | 'type'>) {
  const shown = String(value);
  const [txt, setTxt] = useState(shown);
  useEffect(() => setTxt(shown), [shown]);
  // blur() inside the Escape handler runs onBlur before the reverted text renders
  const cancel = useRef(false);
  const commit = () => {
    const v = cancel.current ? null : parseNumberText(txt, min, max, integer);
    cancel.current = false;
    if (v === null || v === value) { setTxt(shown); return; }
    onCommit(v);
  };
  return (
    <input {...rest} type="number" min={min} max={max} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur(); }
      }} />
  );
}

function updSide(i: 0 | 1, f: (s: SideSpec) => SideSpec) {
  setScenario((sc) => {
    const sides = [...sc.sides] as Scenario['sides'];
    sides[i] = f(sides[i]);
    return { ...sc, sides };
  });
}

/** Side i's members with each id swapped for pick(id), except where the new id is already in
 *  the scenario (on either side, or picked for an earlier member here): that member keeps its id
 *  and the new id is listed in `refused`. The year picker and "Set side year" used to swap
 *  without this check, which put one snapshot on both sides and fought a nation against itself. */
export function swapMembers(sides: Scenario['sides'], i: 0 | 1, pick: (id: string) => string): { members: string[]; refused: string[] } {
  const taken = new Set(sides.flatMap((x) => x.members));
  const refused: string[] = [];
  const members = sides[i].members.map((id) => {
    const to = pick(id);
    if (to === id) return id;
    if (taken.has(to)) { refused.push(to); return id; }
    taken.add(to);
    return to;
  });
  return { members, refused };
}

function SideEditor({ i, data, sc, itemById }: { i: 0 | 1; data: AppData; sc: Scenario; itemById: Map<string, SearchItem> }) {
  const side = sc.sides[i];
  const letter = SIDE_LETTER[i];
  const mapMode = useStore((s) => s.mapMode);
  const [year, setYear] = useState('');
  const placing = mapMode.kind === 'start' && mapMode.side === i;
  const starts = side.startPositions?.length ?? 0;
  // Phase 3 ids load their era first; the check reads the store, not the (older) props.
  const addIds = (ids: string[]) => ensureSnapshots(ids).then(() => updSide(i, (s) => {
    const taken = new Set(store.get().scenario.sides.flatMap((x) => x.members));
    const known = store.get().data?.snapById ?? data.snapById;
    return { ...s, members: [...s.members, ...ids.filter((id) => !taken.has(id) && known.has(id))] };
  }));
  // Swap members for other years of their nation, refusing (with a toast) a year already in the
  // scenario, as addIds does for a new member. setScenario runs `f` at once, so `refused` is set.
  const swap = (pick: (id: string) => string) => {
    let refused: string[] = [];
    setScenario((sc) => {
      const r = swapMembers(sc.sides, i, pick);
      refused = r.refused;
      if (r.members.every((m, k) => m === sc.sides[i].members[k])) return sc;
      const sides = [...sc.sides] as Scenario['sides'];
      sides[i] = { ...sides[i], members: r.members };
      return { ...sc, sides };
    });
    if (refused.length) {
      const d = store.get().data ?? data;
      const label = (id: string) => { const s = d.snapById.get(id); return s ? `${s.name} (${yearLabel(s.year)})` : id; };
      toast(`Already in this scenario, so not swapped in: ${refused.map(label).join(', ')}.`);
    }
  };
  const snapToYear = () => {
    const y = parseInt(year, 10);
    if (!Number.isFinite(y)) { toast('Enter a year (negative for BCE).'); return; }
    swap((id) => {
      const snap = data.snapById.get(id);
      const nat = snap && data.nationById.get(snap.nationId);
      if (!nat) return id;
      let best = id, bd = Infinity;
      for (const sid of nat.snapshotIds) {
        const oy = yearOf(data, sid);
        if (oy != null && Math.abs(oy - y) < bd) { bd = Math.abs(oy - y); best = sid; }
      }
      return best;
    });
    void ensureSnapshots(store.get().scenario.sides[i].members);
  };
  return (
    <fieldset className="side" style={{ borderColor: side.color }}>
      <legend>
        <input type="color" value={side.color} onChange={(e) => updSide(i, (s) => ({ ...s, color: e.target.value }))} title="Side colour" aria-label={`Side ${letter} colour`} />
        <input className="side-name" value={side.name} aria-label={`Side ${letter} name`} onChange={(e) => updSide(i, (s) => ({ ...s, name: e.target.value }))} />
        <span className="side-count muted small">{side.members.length === 1 ? '1 nation' : `${side.members.length} nations`}</span>
      </legend>
      {side.members.length === 0 && <div className="muted small">No nations yet. Search below, or add them from the Nations tab.</div>}
      <ul className="members">
        {side.members.map((id, k) => {
          const s = data.snapById.get(id);
          const nat = s ? data.nationById.get(s.nationId) : undefined;
          const excluded = s && (sc.excluded.includes(s.nationId));
          const it = itemById.get(id);
          // a loaded link may still list an id twice (Run is blocked until it is removed); keep keys unique
          const dup = side.members.indexOf(id) !== k;
          return (
            <li key={dup ? `${id}#${k}` : id} className={excluded ? 'excluded' : ''}>
              <span className="member-name" title={id}>{s
                ? <button className="link member-link" title="Show the key numbers and sources in the Nations tab" onClick={() => showInNations(`${s.name} ${yearLabel(s.year)}`, id)}>{s.name}</button>
                : data.phase3ById.has(id) ? <span className="muted">loading {id}...</span> : <span className="warn">unknown: {id}</span>}</span>
              {/* researched is the default; auto-base and derived members are flagged */}
              {it && it.kind !== 'researched' && <KindBadge kind={it.kind} grade={it.confidence} compact />}
              {nat && nat.snapshotIds.length > 1 ? (
                <select title="Pick another year of this nation (derived = Phase 3, low confidence)" aria-label={`Year of ${s?.name ?? id}`} value={id} onChange={(e) => { const v = e.target.value; void ensureSnapshots([v]).then(() => swap((m) => (m === id ? v : m))); }}>
                  {nat.snapshotIds.map((sid) => { const oy = yearOf(data, sid); return <option key={sid} value={sid}>{oy != null ? yearLabel(oy) : sid}{data.phase3ById.has(sid) ? ' derived' : ''}</option>; })}
                </select>
              ) : s ? <span className="muted">{yearLabel(s.year)}</span> : null}
              <button className="x" title="Remove" aria-label={`Remove ${s?.name ?? id}`} onClick={() => updSide(i, (x) => ({ ...x, members: x.members.filter((m) => m !== id) }))}>x</button>
            </li>
          );
        })}
      </ul>
      <SnapshotSearch data={data} placeholder="Add a nation: name, tag or year..." onPick={(id) => addIds([id])}
        taken={(id) => { const k = sc.sides.findIndex((x) => x.members.includes(id)); return k >= 0 ? sc.sides[k].name : null; }} />
      <Section id={`side${i}`} title="More options" idle="" summary={starts ? [`${starts} start point${starts > 1 ? 's' : ''}`] : []}>
        {data.coalitions.length > 0 && (
          <select value="" aria-label={`Add a ready-made alliance to side ${letter}`} onChange={(e) => { const c = data.coalitions.find((x) => x.id === e.target.value); if (c) addIds(c.members); }}>
            <option value="">Add a ready-made alliance...</option>
            {data.coalitions.map((c) => <option key={c.id} value={c.id}>{c.name} ({yearLabel(c.year)}, {c.members.length})</option>)}
          </select>
        )}
        <div className="row">
          <input className="narrow" placeholder="Year" aria-label={`Year for every nation on side ${letter} (negative for BCE)`} value={year} onChange={(e) => setYear(e.target.value)} />
          <button onClick={snapToYear} title="Swap every nation on this side to its version nearest this year">Set side year</button>
        </div>
        <div className="row">
          <button className={placing ? 'on' : ''} aria-pressed={placing} onClick={() => store.set({ mapMode: placing ? { kind: 'none' } : { kind: 'start', side: i } })}>
            {placing ? 'Done placing' : 'Place start points'}
          </button>
          {starts > 0 && (
            <button onClick={() => updSide(i, (s) => ({ ...s, startPositions: undefined }))}>Clear {starts}</button>
          )}
          <span className="muted small">{starts ? '' : 'Default: own cities, or the edge nearest home'}</span>
        </div>
      </Section>
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
            <button className="x" aria-label={`Stop excluding ${data.nationById.get(n)?.name ?? n}`} onClick={() => setScenario((s) => ({ ...s, excluded: s.excluded.filter((x) => x !== n) }))}>x</button>
          </span>
        ))}
      </div>
      <input list="nations-dl" value={v} placeholder="Exclude a nation..." aria-label="Exclude a nation" onChange={(e) => {
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

/** Non-default values per section, for the one-line summaries on the closed sections. */
function summaries(sc: Scenario, anchors: string[]) {
  const lvl = sc.equalizedTech ?? 8;
  const tech = sc.techMode === 'equalized' ? [`same tech level ${lvl} (about ${anchors[Math.round(lvl)] ?? ''})`]
    : sc.techMode === 'timeslice' ? ['year per nation'] : [];
  const rules: string[] = [];
  for (const [k, l] of RULES) if (sc.rules[k] !== DEFAULT_RULES[k]) rules.push(`${l.toLowerCase()} ${sc.rules[k] ? 'ON' : 'OFF'}`);
  if (sc.rules.nuclear !== DEFAULT_RULES.nuclear) rules.push(`nuclear ${sc.rules.nuclear ? 'ON' : 'OFF'}`);
  const v = sc.victory, victory: string[] = [];
  if (v.capitalCaptured !== DEFAULT_VICTORY.capitalCaptured) victory.push(`capital ${v.capitalCaptured ? 'ON' : 'OFF'}`);
  if (v.armyCollapse !== DEFAULT_VICTORY.armyCollapse) victory.push(`army collapse ${v.armyCollapse ? 'ON' : 'OFF'}`);
  if (v.territoryShare !== DEFAULT_VICTORY.territoryShare) victory.push(v.territoryShare === 0 ? 'land share off' : `hold ${Math.round(v.territoryShare * 100)}% of land`);
  if (v.timeLimitDays !== DEFAULT_VICTORY.timeLimitDays) victory.push(`${v.timeLimitDays.toLocaleString('en-US')} day limit`);
  const advanced: string[] = [];
  if (sc.startMonth !== DEFAULT_MONTH) advanced.push(`starts in ${MONTHS[sc.startMonth - 1] ?? sc.startMonth}`);
  if (sc.seed !== 1) advanced.push(`seed ${sc.seed}`);
  // a named area already shows in the Where heading; a hand-typed box points here
  if (sc.theater.name === 'Custom') advanced.push('custom area');
  if (sc.excluded.length) advanced.push(`${sc.excluded.length} excluded`);
  return { tech, rules, victory, advanced };
}

export function ScenarioBuilder() {
  const data = useStore((s) => s.data);
  const sc = useStore((s) => s.scenario);
  const mapMode = useStore((s) => s.mapMode);
  const runStatus = useStore((s) => s.run.status);
  const [mcRuns, setMcRuns] = useState(100);
  const [mcCustom, setMcCustom] = useState(false);
  const itemById = useMemo(() => new Map(data ? buildItems(data).map((x) => [x.id, x]) : []), [data]);
  if (!data) return <div className="panel-body muted">Loading data...</div>;
  const problems = scenarioProblems(sc);
  const anchors = data.mechanics?.techLevels?.length ? data.mechanics.techLevels.map((t) => t.label) : TECH_ANCHORS;
  const setBBox = (b: BBox, name: string) => setScenario((s) => ({ ...s, theater: { name, bbox: b } }));
  const drawing = mapMode.kind === 'bbox';
  const sum = summaries(sc, anchors);
  const fits = fitChoices(sc, data.snapById);

  return (
    <div className="panel-body scenario">
      {data.snapshots.length === 0 && <div className="notice">No nation data loaded yet; sides cannot be filled until <code>snapshots.json</code> exists.</div>}

      <h4 className="sb-first">Who fights</h4>
      <SideEditor i={0} data={data} sc={sc} itemById={itemById} />
      <div className="vs" aria-hidden="true"><span>vs</span></div>
      <SideEditor i={1} data={data} sc={sc} itemById={itemById} />

      <h4>Where: {sc.theater.name}</h4>
      <div className="chips" role="group" aria-label="Theater">
        {fits.map((f) => {
          // keyed and matched by side, not name: two far-apart sides with one name gave two
          // chips with one key, both lit; the box tells them apart
          const on = sc.theater.name === f.name && (f.around === null || sc.theater.bbox.join() === f.bbox.join());
          return (
            <button key={f.around ?? 'both'} className={on ? 'on' : ''} aria-pressed={on} onClick={() => setBBox(f.bbox, f.name)}
              title={f.around === null ? "A box around both sides' capitals and nearby cities" : `The war is fought around ${sc.sides[f.around].name}; ${sc.sides[1 - f.around].name} comes in by land or sea`}>
              {f.around === null ? 'Around the sides' : f.name}
            </button>
          );
        })}
        {THEATERS.map((t) => (
          <button key={t.name} className={sc.theater.name === t.name ? 'on' : ''} aria-pressed={sc.theater.name === t.name} onClick={() => setBBox([...t.bbox] as BBox, t.name)}>{t.name}</button>
        ))}
        <button className={drawing ? 'on' : ''} aria-pressed={drawing} onClick={() => store.set({ mapMode: drawing ? { kind: 'none' } : { kind: 'bbox' } })}>
          {drawing ? 'Click two corners (Esc)' : 'Draw on map'}
        </button>
      </div>

      <div className="sb-sections">
        <Section id="tech" title="Era and technology" summary={sum.tech}>
          <div className="radio-row" role="radiogroup" aria-label="Technology">
            {TECH_MODES.map(([m, l]) => (
              <label key={m}><input type="radio" name="tech-mode" checked={sc.techMode === m} onChange={() => setScenario((s) => ({ ...s, techMode: m }))} /> {l}</label>
            ))}
          </div>
          {sc.techMode === 'equalized' && (
            <div className="field">
              <input type="range" min={0} max={10} step={0.5} aria-label="Tech level for both sides" value={sc.equalizedTech ?? 8} onChange={(e) => setScenario((s) => ({ ...s, equalizedTech: +e.target.value }))} />
              <div className="small">Both sides fight at tech level {sc.equalizedTech ?? 8} (about {anchors[Math.round(sc.equalizedTech ?? 8)] ?? ''}). Population, economy, geography and doctrine stay their own; unit types that do not exist at that level are converted.</div>
            </div>
          )}
          {sc.techMode === 'timeslice' && <div className="small muted">Pick a year with the dropdown next to each nation, or set a whole side's year under "More options" on that side.</div>}
          {sc.techMode === 'native' && <div className="small muted">Each side keeps the weapons, tactics and logistics of its own time. Lopsided results are shown with their reasons.</div>}
        </Section>

        <Section id="rules" title="Rules" summary={sum.rules} warn={sc.rules.nuclear}>
          <div className="toggles">
            {RULES.map(([k, l, hint]) => (
              <Toggle key={k} label={l} hint={hint} checked={sc.rules[k]} onChange={(v) => setScenario((s) => ({ ...s, rules: { ...s.rules, [k]: v } }))} />
            ))}
            <Toggle label="Nuclear weapons" checked={sc.rules.nuclear} hint="Off by default. Asks before turning on." onChange={(v) => {
              if (v && !confirm('Enable nuclear weapons?\n\nThe engine then uses the documented escalation model in ENGINE.md. Results of nuclear use are extremely uncertain and dominate every other factor.')) return;
              setScenario((s) => ({ ...s, rules: { ...s.rules, nuclear: v } }));
            }} />
          </div>
        </Section>

        <Section id="victory" title="Victory conditions" summary={sum.victory}>
          <div className="toggles">
            <Toggle label="Capital captured" hint="A side wins when it takes the enemy capital" checked={sc.victory.capitalCaptured} onChange={(v) => setScenario((s) => ({ ...s, victory: { ...s.victory, capitalCaptured: v } }))} />
            <Toggle label="Enemy army collapses" hint="A side wins when the enemy army breaks" checked={sc.victory.armyCollapse} onChange={(v) => setScenario((s) => ({ ...s, victory: { ...s.victory, armyCollapse: v } }))} />
          </div>
          <label className="field">Hold this share of enemy land: {sc.victory.territoryShare === 0 ? 'off' : `${Math.round(sc.victory.territoryShare * 100)}%`}
            <input type="range" min={0} max={1} step={0.05} value={sc.victory.territoryShare} onChange={(e) => setScenario((s) => ({ ...s, victory: { ...s.victory, territoryShare: +e.target.value } }))} />
          </label>
          <label className="field">Time limit (days)
            <NumberField min={1} max={MAX_TIME_LIMIT_DAYS} integer value={sc.victory.timeLimitDays} onCommit={(v) => setScenario((s) => ({ ...s, victory: { ...s.victory, timeLimitDays: v } }))} />
          </label>
        </Section>

        <Section id="advanced" title="Advanced" summary={sum.advanced}>
          <label className="field">Scenario name
            <input className="title-input" value={sc.name} onChange={(e) => setScenario((s) => ({ ...s, name: e.target.value }))} />
          </label>
          <label className="field">Description
            <textarea rows={2} placeholder="Optional notes" value={sc.description} onChange={(e) => setScenario((s) => ({ ...s, description: e.target.value }))} />
          </label>
          <label className="field">Start month (sets the season)
            <select value={sc.startMonth} onChange={(e) => setScenario((s) => ({ ...s, startMonth: +e.target.value }))}>
              {MONTHS.map((m, j) => <option key={m} value={j + 1}>{m}</option>)}
            </select>
          </label>
          <div className="sb-label" id="sb-seed">Random seed</div>
          <div className="row">
            <NumberField className="seed" aria-labelledby="sb-seed" min={0} max={MAX_SEED} integer value={sc.seed} onCommit={(v) => setScenario((s) => ({ ...s, seed: v }))} />
            <button onClick={() => setScenario((s) => ({ ...s, seed: Math.floor(Math.random() * 2 ** 31) }))}>New seed</button>
          </div>
          <div className="muted small">The same seed and setup give the same war.</div>
          <div className="sb-label">Exact area (degrees)</div>
          <div className="bbox">
            {BOX_LABELS.map((k, j) => (
              <label key={k}>{k}
                {/* latitudes stop at the poles (the map throws past them); longitude may pass 180
                    as the Pacific preset's east = 210 does, within one turn either way */}
                <NumberField step={0.25} min={j % 2 ? -90 : -360} max={j % 2 ? 90 : 360} value={sc.theater.bbox[j]} onCommit={(v) => {
                  const b = [...sc.theater.bbox] as BBox;
                  b[j] = v;
                  setBBox(b, 'Custom');
                }} />
              </label>
            ))}
          </div>
          <div className="sb-label">Excluded nations</div>
          <ExcludedEditor data={data} sc={sc} />
        </Section>
      </div>

      {sc.overrides.length > 0 && <div className="notice">{sc.overrides.length} edited value{sc.overrides.length > 1 ? 's' : ''} in this scenario (Editor tab).</div>}
      {sc.rules.nuclear && <div className="notice warn">Nuclear use is ON. The escalation model is a documented simplification (ENGINE.md); treat any result as illustrative only.</div>}
      {problems.length > 0 && <ul className="problems">{problems.map((p, k) => <li key={k}>{p}</li>)}</ul>}
      <div className="sticky-actions">
        <button className="primary run-main" disabled={problems.length > 0 || runStatus === 'starting'} onClick={() => startRun(sc, getSettings().startSpeed)}>Run war</button>
        <div className="mc-row">
          <button className="mc-run" disabled={problems.length > 0} title="Play the same war many times with different random seeds and see how often each side wins"
            onClick={() => { runMonteCarlo(sc, mcRuns); store.set({ rightTab: 'montecarlo' }); }}>
            Run {mcRuns.toLocaleString('en-US')} times <span className="muted">(Monte Carlo)</span>
          </button>
          <select aria-label="Number of Monte Carlo runs" value={mcCustom ? 'custom' : String(mcRuns)} onChange={(e) => {
            const v = e.target.value;
            setMcCustom(v === 'custom');
            if (v !== 'custom') setMcRuns(+v);
          }}>
            {MC_CHOICES.map((n) => <option key={n} value={n}>{n.toLocaleString('en-US')} runs</option>)}
            <option value="custom">Custom...</option>
          </select>
          {mcCustom && (
            <NumberField className="narrow" min={2} max={5000} integer aria-label="Custom number of runs (2 to 5,000)" value={mcRuns} onCommit={setMcRuns} />
          )}
        </div>
      </div>
    </div>
  );
}
