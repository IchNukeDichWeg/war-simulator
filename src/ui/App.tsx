import { useEffect, useState } from 'react';
import { MapView } from '../map/MapView';
import { flyBus } from './bus';
import { loadData } from './data';
import { ensureEngineAssets } from './lazy';
import { ErrorBoundary } from './ErrorBoundary';
import { Icon, type IconName } from './Icon';
import { LimitsPage } from './LimitsPage';
import { Editor } from './panels/Editor';
import { MapToolbar } from './panels/MapToolbar';
import { NationBrowser } from './panels/NationBrowser';
import { loadScenario, Presets } from './panels/Presets';
import { RunPanel } from './panels/RunPanel';
import { ScenarioBuilder } from './panels/ScenarioBuilder';
import { TimeBar } from './panels/TimeBar';
import { downloadScenario, scenarioFromHash, shareUrl, uploadScenario } from './scenarioIO';
import { store, toast, useStore, type LeftTab } from './store';

const NONE: string[] = [];

export const BANNER = 'Model output, not a prediction: every number carries a confidence grade.';

// Theme: 'auto' follows the OS through color-scheme: light dark; light or dark pins it via
// html[data-theme]. Stored per browser only, so it never travels in a shared scenario.
type ThemePref = 'auto' | 'light' | 'dark';
const THEME_KEY = 'mews.theme';
const THEME_NEXT: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_LABEL: Record<ThemePref, string> = { auto: 'match system', light: 'light', dark: 'dark' };
// header colour per theme, for the browser chrome on phones
const THEME_COLOR = { light: '#ffffff', dark: '#131923' };

function readThemePref(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}
function applyTheme(p: ThemePref) {
  const root = document.documentElement;
  if (p === 'auto') delete root.dataset.theme; else root.dataset.theme = p;
  // pinned theme overrides both media-scoped theme-color tags; auto restores each one
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const own = (m.getAttribute('media') ?? '').includes('light') ? 'light' : 'dark';
    m.content = THEME_COLOR[p === 'auto' ? own : p];
  });
}
// before first render, so a pinned theme does not flash the system one
applyTheme(readThemePref());

function ThemeToggle() {
  const [pref, setPref] = useState(readThemePref);
  useEffect(() => {
    applyTheme(pref);
    try { if (pref === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, pref); } catch { /* private mode: not remembered */ }
  }, [pref]);
  const next = THEME_NEXT[pref];
  const label = `Theme: ${THEME_LABEL[pref]}. Switch to ${THEME_LABEL[next]}.`;
  return (
    <button className="icon-btn theme-toggle" onClick={() => setPref(next)} aria-label={label} title={label}>
      <Icon name={pref === 'auto' ? 'auto' : pref === 'light' ? 'sun' : 'moon'} />
    </button>
  );
}

async function share() {
  try {
    const url = await shareUrl(store.get().scenario);
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast(`Share link copied (${url.length} characters).`); }
    catch { toast('Share link is in the address bar.'); }
  } catch (e) { toast('Could not build share link: ' + (e as Error).message); }
}

function BrandMark() {
  return (
    <svg className="brand-mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1.5 3.5 4.75v6.5c0 5.4 3.6 9.7 8.5 11.25 4.9-1.55 8.5-5.85 8.5-11.25v-6.5z" fill="currentColor" />
      <path d="M8 7.5l8 8M16 7.5l-8 8M7 14.5l2.5 2.5M17 14.5 14.5 17" stroke="var(--c-on-accent)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function TopBar() {
  const name = useStore((s) => s.scenario.name);
  const missing = useStore((s) => s.data?.missing) ?? NONE;
  const loaded = useStore((s) => !!s.data);
  return (
    <header className="top">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">Multi-Era War Simulator</span>
      </div>
      <div className="scn-name" title={`Current scenario: ${name}`}>
        <span className="scn-label">Scenario</span>
        <span className="scn-title">{name}</span>
      </div>
      {loaded && missing.length > 0 && (
        <div className="data-status" title={`Missing or empty: ${missing.join(', ')}`}>data incomplete: {missing.length} file{missing.length > 1 ? 's' : ''}</div>
      )}
      <div className="actions">
        <button className="hdr-btn" onClick={() => { try { downloadScenario(store.get().scenario); } catch (e) { toast('Could not save: ' + (e as Error).message); } }} title="Download scenario JSON">
          <Icon name="download" /><span className="lbl">Save</span>
        </button>
        <button className="hdr-btn" onClick={() => uploadScenario().then((s) => loadScenario(s, 'Scenario file loaded')).catch((e) => toast('Load failed: ' + (e as Error).message))} title="Load scenario JSON">
          <Icon name="upload" /><span className="lbl">Load</span>
        </button>
        <button className="hdr-btn" onClick={share} title="Copy a URL that contains this scenario">
          <Icon name="link" /><span className="lbl">Share URL</span>
        </button>
        <span className="actions-sep" aria-hidden="true" />
        <button className="hdr-btn limits-btn" onClick={() => store.set({ showLimits: true })} title="What the model can and cannot say" aria-haspopup="dialog">
          <Icon name="info" /><span className="lbl">Honest limits</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

// Quick start comes first: a ready matchup is the shortest path to a running war
const LEFT_TABS: [LeftTab, string][] = [['start', 'Quick start'], ['setup', 'Setup'], ['nations', 'Nations'], ['editor', 'Editor']];

function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const open = useStore((s) => s.leftOpen);
  // WAI-ARIA tabs: arrow keys move between tabs, Home/End jump, Tab leaves the strip
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = LEFT_TABS.findIndex(([k]) => k === tab);
    const n = LEFT_TABS.length;
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    store.set({ leftTab: LEFT_TABS[j][0], leftOpen: true });
    document.getElementById(`ltab-${LEFT_TABS[j][0]}`)?.focus();
  };
  return (
    <aside className={`left${open ? '' : ' closed'}`} aria-label="Scenario setup">
      <nav className="tabs">
        <div className="tablist" role="tablist" aria-label="Setup panels" aria-orientation={open ? 'horizontal' : 'vertical'} onKeyDown={onKey}>
          {LEFT_TABS.map(([k, l]) => (
            <button key={k} id={`ltab-${k}`} role="tab" aria-selected={open && tab === k} aria-controls="left-tabpanel" tabIndex={tab === k ? 0 : -1}
              className={tab === k ? 'on' : ''} onClick={() => store.set({ leftTab: k, leftOpen: true })}>{l}</button>
          ))}
        </div>
        <button className="collapse icon-btn" aria-expanded={open} aria-label={open ? 'Collapse setup panel' : 'Expand setup panel'} title={open ? 'Collapse' : 'Expand'}
          onClick={() => store.set({ leftOpen: !open })}><Icon name={open ? 'chevronLeft' : 'chevronRight'} /></button>
      </nav>
      {open && (
        <div className="tabpanel" role="tabpanel" id="left-tabpanel" aria-labelledby={`ltab-${tab}`}>
          <ErrorBoundary name={tab}>
            {tab === 'start' && <Presets />}
            {tab === 'setup' && <ScenarioBuilder />}
            {tab === 'nations' && <NationBrowser />}
            {tab === 'editor' && <Editor />}
          </ErrorBoundary>
        </div>
      )}
    </aside>
  );
}

// Under 900 px only one of setup, map and results is shown at a time; the side panels become
// full-size drawers over the map (CSS keys off main[data-pane]). Wider screens ignore it.
type Pane = 'setup' | 'map' | 'results';
const PANES: [Pane, string, IconName][] = [['setup', 'Setup', 'sliders'], ['map', 'Map', 'map'], ['results', 'Results', 'chart']];

function PaneNav({ pane, choose }: { pane: Pane; choose: (p: Pane) => void }) {
  const hasResult = useStore((s) => !!s.run.result);
  return (
    <nav className="pane-nav" aria-label="Panels">
      {PANES.map(([k, l, icon]) => (
        <button key={k} className={pane === k ? 'on' : ''} aria-pressed={pane === k} onClick={() => choose(k)}>
          <Icon name={icon} size={18} />
          <span>{l}</span>
          {k === 'results' && hasResult && <span className="pane-dot" title="Result ready" />}
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const showLimits = useStore((s) => s.showLimits);
  const toastMsg = useStore((s) => s.toast);
  const fixtures = useStore((s) => !!s.data?.fixtures);
  const mapMode = useStore((s) => s.mapMode);
  const runStatus = useStore((s) => s.run.status);
  const [pane, setPane] = useState<Pane>('map');
  const choose = (p: Pane) => { setPane(p); if (p === 'setup') store.set({ leftOpen: true }); };
  // jump to the map when something there needs the user: a run starting, a click-on-map mode, a fly-to
  useEffect(() => { if (runStatus === 'starting') setPane('map'); }, [runStatus]);
  useEffect(() => { if (mapMode.kind !== 'none') setPane('map'); }, [mapMode.kind]);
  useEffect(() => flyBus.on(() => setPane('map')), []);

  useEffect(() => {
    let alive = true;
    loadData().then(async (data) => {
      if (!alive) return;
      store.set({ data });
      void ensureEngineAssets();
      try {
        const fromHash = await scenarioFromHash();
        if (fromHash) { loadScenario(fromHash, 'Scenario loaded from link'); return; }
      } catch (e) { toast('Share link could not be read: ' + (e as Error).message); }
      if (data.presets.length > 0 && store.get().scenario.sides.every((s) => s.members.length === 0)) {
        store.set({ scenario: structuredClone(data.presets[0]) });
      }
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="app">
      <TopBar />
      {fixtures && <div className="fixture-banner">DEV FIXTURES: synthetic placeholder data for UI development. Not real data, not runnable.</div>}
      <main data-pane={pane}>
        <LeftPanel />
        <section className="center">
          <ErrorBoundary name="map" fallback={(err) => (
            <div className="map-fallback">
              <div className="notice warn" role="alert">
                {/webgl/i.test(err.message) ? 'The map needs WebGL2, which this browser does not provide.' : `The map failed: ${err.message}`}
                {' '}The other panels work without it.
              </div>
            </div>
          )}>
            <MapView />
          </ErrorBoundary>
          <MapToolbar />
          {mapMode.kind !== 'none' && (
            <div className="mode-hint" role="status">
              {mapMode.kind === 'bbox' ? 'Click two opposite corners of the theater. Esc cancels.' : `Click to add start points for side ${mapMode.side === 0 ? 'A' : 'B'}. Esc ends.`}
            </div>
          )}
          <TimeBar />
        </section>
        <ErrorBoundary name="run"><RunPanel /></ErrorBoundary>
      </main>
      <footer className="banner"><Icon name="info" size={14} /><span>{BANNER}</span></footer>
      <PaneNav pane={pane} choose={choose} />
      {/* always mounted, so screen readers announce each new message */}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toastMsg && <div className="toast" key={toastMsg}>{toastMsg}</div>}
      </div>
      {showLimits && <ErrorBoundary name="limits"><LimitsPage /></ErrorBoundary>}
    </div>
  );
}
