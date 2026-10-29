import { useMemo, useState } from 'react';
import type { EraId, Est, RegionId, Snapshot } from '../../types/schema';
import { ERA_SPANS } from '../../types/schema';
import { yearLabel } from '../data';
import { EstValue, GradeBadge } from '../Grade';

import { ROLE_LABEL, ROLE_ORDER } from '../roles';
import { setScenario, store, toast, useStore } from '../store';
import { EmptyData } from './EmptyData';

export const ERA_LABEL: Record<EraId, string> = {
  bronze: 'Bronze Age', iron: 'Iron Age / Classical', medieval: 'Medieval', gunpowder: 'Gunpowder',
  industrial: 'Napoleonic / industrial', worldwars: 'World Wars', coldwar: 'Cold War', modern: 'Modern',
};
export const REGION_LABEL: Record<RegionId, string> = {
  europe: 'Europe', mena: 'Middle East / N. Africa', subsaharan_africa: 'Sub-Saharan Africa', central_asia: 'Central Asia',
  south_asia: 'South Asia', east_asia: 'East Asia', southeast_asia: 'Southeast Asia', north_america: 'North America',
  latin_america: 'Latin America', oceania: 'Oceania',
};

export function addMember(side: 0 | 1, id: string) {
  setScenario((sc) => {
    if (sc.sides.some((s) => s.members.includes(id))) { toast('Already in the scenario.'); return sc; }
    const sides = [...sc.sides] as typeof sc.sides;
    sides[side] = { ...sides[side], members: [...sides[side].members, id] };
    return { ...sc, sides };
  });
}

function matches(s: Snapshot, q: string, aliases: string[]) {
  if (!q) return true;
  const hay = `${s.name} ${s.id} ${s.tags.join(' ')} ${aliases.join(' ')} ${yearLabel(s.year)}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function NationBrowser() {
  const data = useStore((s) => s.data);
  const compare = useStore((s) => s.compare);
  const [q, setQ] = useState('');
  const [era, setEra] = useState<EraId | ''>('');
  const [region, setRegion] = useState<RegionId | ''>('');
  const [limit, setLimit] = useState(120);

  const list = useMemo(() => {
    if (!data) return [];
    return data.snapshots.filter((s) => (!era || s.era === era) && (!region || s.region === region)
      && matches(s, q, data.nationById.get(s.nationId)?.aliases ?? []));
  }, [data, q, era, region]);

  if (!data) return <div className="panel-body muted">Loading data...</div>;
  if (data.snapshots.length === 0) return <EmptyData what="nation snapshots" file="snapshots.json" />;

  const setCmp = (i: 0 | 1, id: string) => {
    const c: [string | null, string | null] = [...store.get().compare];
    c[i] = id;
    store.set({ compare: c });
  };

  return (
    <div className="panel-body">
      <div className="filters">
        <input type="search" placeholder={`Search ${data.snapshots.length} snapshots (name, tag, year)`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          <select value={era} onChange={(e) => setEra(e.target.value as EraId | '')}>
            <option value="">All eras</option>
            {(Object.keys(ERA_SPANS) as EraId[]).map((e) => <option key={e} value={e}>{ERA_LABEL[e]}</option>)}
          </select>
          <select value={region} onChange={(e) => setRegion(e.target.value as RegionId | '')}>
            <option value="">All regions</option>
            {(Object.keys(REGION_LABEL) as RegionId[]).map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="muted small">{list.length} match{list.length === 1 ? '' : 'es'}. Click C1 / C2 to compare two snapshots.</div>
      </div>
      {compare[0] && compare[1] && <Compare a={data.snapById.get(compare[0])} b={data.snapById.get(compare[1])} />}
      <ul className="snap-list">
        {list.slice(0, limit).map((s) => (
          <li key={s.id} className={compare.includes(s.id) ? 'sel' : ''}>
            <div className="snap-main">
              <b>{s.name}</b> <span className="muted">{yearLabel(s.year)}</span>
              <div className="muted small">{ERA_LABEL[s.era]} | {REGION_LABEL[s.region] ?? s.region} | {s.phase}{s.tags.length ? ` | ${s.tags.slice(0, 3).join(', ')}` : ''}</div>
              <div className="small">pop <EstValue e={s.demography.population} /> active <EstValue e={s.military.activePersonnel} /></div>
            </div>
            <div className="snap-actions">
              <button title="Add to side A" onClick={() => addMember(0, s.id)}>+A</button>
              <button title="Add to side B" onClick={() => addMember(1, s.id)}>+B</button>
              <button title="Compare slot 1" className={compare[0] === s.id ? 'on' : ''} onClick={() => setCmp(0, s.id)}>C1</button>
              <button title="Compare slot 2" className={compare[1] === s.id ? 'on' : ''} onClick={() => setCmp(1, s.id)}>C2</button>
              <button title="Open in editor" onClick={() => store.set({ leftTab: 'editor', editorSnapshot: s.id })}>Edit</button>
            </div>
          </li>
        ))}
      </ul>
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

function Compare({ a, b }: { a?: Snapshot; b?: Snapshot }) {
  if (!a || !b) return null;
  return (
    <div className="compare">
      <div className="compare-head">
        <span />
        <b>{a.name} {yearLabel(a.year)}</b>
        <b>{b.name} {yearLabel(b.year)}</b>
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
