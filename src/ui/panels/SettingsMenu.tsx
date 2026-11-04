import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { BASEMAPS, DEFAULT_SETTINGS, START_SPEEDS, UNIT_SIZES, resetSettings, setSettings, useSettings, type Settings } from '../settings';

/** One choice as a segmented control: the same look as the time bar's speeds. */
function Choice<K extends string | number>({ label, value, options, onPick }: {
  label: string; value: K; options: [K, string, string?][]; onPick: (k: K) => void;
}) {
  return (
    <div className="set-row">
      <span className="set-label" id={`set-${label}`}>{label}</span>
      <div className="seg" role="group" aria-labelledby={`set-${label}`}>
        {options.map(([k, l, hint]) => (
          <button key={String(k)} className={value === k ? 'on' : ''} aria-pressed={value === k} title={hint} onClick={() => onPick(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/** Header gear: viewer preferences for the map and runs. Nothing here reaches the engine or a
 *  shared scenario, so two people with different settings still see the same war. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const s = useSettings();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const set = (p: Partial<Settings>) => setSettings(p);
  const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).some((k) => s[k] !== DEFAULT_SETTINGS[k]);
  return (
    <div className="hdr-menu" ref={wrap}>
      <button ref={btn} className="hdr-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'settings-panel' : undefined}
        title="Display settings: map style, unit size, run speed" onClick={() => setOpen((o) => !o)}>
        <Icon name="settings" /><span className="lbl">Settings</span>
      </button>
      {open && (
        <div className="hdr-menu-list settings-panel" id="settings-panel" role="dialog" aria-label="Display settings">
          <Choice label="Map" value={s.basemap} options={BASEMAPS} onPick={(basemap) => set({ basemap })} />
          <Choice label="Units" value={s.unitSize} options={UNIT_SIZES} onPick={(unitSize) => set({ unitSize })} />
          <Choice label="Runs start" value={s.startSpeed} options={START_SPEEDS.map(([k, l]) => [k, l, `${k} day${k === 1 ? '' : 's'} per second`])} onPick={(startSpeed) => set({ startSpeed })} />
          <label className="set-check">
            <input type="checkbox" checked={s.rememberLayers} onChange={(e) => set({ rememberLayers: e.target.checked })} />
            Remember map layers between visits
          </label>
          <div className="set-foot">
            <span className="muted">Saved in this browser only.</span>
            <button className="set-reset" disabled={!changed} onClick={resetSettings}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
