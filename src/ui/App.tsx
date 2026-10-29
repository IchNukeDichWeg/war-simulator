import { useEffect } from 'react';
import { MapView } from '../map/MapView';
import { loadData } from './data';
import { ErrorBoundary } from './ErrorBoundary';
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

async function share() {
  try {
    const url = await shareUrl(store.get().scenario);
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast(`Share link copied (${url.length} characters).`); }
    catch { toast('Share link is in the address bar.'); }
  } catch (e) { toast('Could not build share link: ' + (e as Error).message); }
}

function TopBar() {
  const name = useStore((s) => s.scenario.name);
  const missing = useStore((s) => s.data?.missing) ?? NONE;
  const loaded = useStore((s) => !!s.data);
  return (
    <header className="top">
      <div className="brand">Multi-Era War Simulator</div>
      <div className="scn-name" title="Current scenario">{name}</div>
      <div className="actions">
        <button onClick={() => downloadScenario(store.get().scenario)} title="Download scenario JSON">Save</button>
        <button onClick={() => uploadScenario().then((s) => loadScenario(s, 'Scenario file loaded')).catch((e) => toast('Load failed: ' + (e as Error).message))} title="Load scenario JSON">Load</button>
        <button onClick={share} title="Copy a URL that contains this scenario">Share URL</button>
        <button onClick={() => store.set({ showLimits: true })}>Honest limits</button>
      </div>
      {loaded && missing.length > 0 && (
        <div className="data-status" title={`Missing or empty: ${missing.join(', ')}`}>data incomplete: {missing.length} file{missing.length > 1 ? 's' : ''}</div>
      )}
    </header>
  );
}

function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const open = useStore((s) => s.leftOpen);
  const tabs: [LeftTab, string][] = [['scenario', 'Scenario'], ['nations', 'Nations'], ['editor', 'Editor'], ['presets', 'Presets']];
  return (
    <aside className={`left${open ? '' : ' closed'}`}>
      <nav className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => store.set({ leftTab: k, leftOpen: true })}>{l}</button>)}
        <button className="collapse" title={open ? 'Collapse' : 'Expand'} onClick={() => store.set({ leftOpen: !open })}>{open ? '<' : '>'}</button>
      </nav>
      <ErrorBoundary name={tab}>
        {open && tab === 'scenario' && <ScenarioBuilder />}
        {open && tab === 'nations' && <NationBrowser />}
        {open && tab === 'editor' && <Editor />}
        {open && tab === 'presets' && <Presets />}
      </ErrorBoundary>
    </aside>
  );
}

export function App() {
  const showLimits = useStore((s) => s.showLimits);
  const toastMsg = useStore((s) => s.toast);
  const fixtures = useStore((s) => !!s.data?.fixtures);
  const mapMode = useStore((s) => s.mapMode);

  useEffect(() => {
    let alive = true;
    loadData().then(async (data) => {
      if (!alive) return;
      store.set({ data });
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
      <main>
        <LeftPanel />
        <section className="center">
          <MapView />
          <MapToolbar />
          {mapMode.kind !== 'none' && (
            <div className="mode-hint">
              {mapMode.kind === 'bbox' ? 'Click two opposite corners of the theater. Esc cancels.' : `Click to add start points for side ${mapMode.side === 0 ? 'A' : 'B'}. Esc ends.`}
            </div>
          )}
          <TimeBar />
        </section>
        <ErrorBoundary name="run"><RunPanel /></ErrorBoundary>
      </main>
      <footer className="banner">{BANNER}</footer>
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {showLimits && <ErrorBoundary name="limits"><LimitsPage /></ErrorBoundary>}
    </div>
  );
}
