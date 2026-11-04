import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { setLayers, useStore, type LayerToggles } from '../store';

type Item = [keyof LayerToggles, string, string];

// Grouped by what a visitor wants: the war itself first, then the base map, then the camera.
const WAR: Item[] = [
  ['control', 'Control', 'Shade the land each side holds in its colour'],
  ['front', 'Front line', 'Line where the two sides meet'],
  ['supply', 'Supply lines', "Dotted supply routes in each side's colour"],
  ['fog', 'Fog of war', 'Show only the enemy units your own units can see (display only)'],
];
const MAP: Item[] = [
  ['borders', 'Borders', 'Historical borders of the selected snapshots (approximate)'],
  ['rivers', 'Rivers', 'Major rivers (Natural Earth)'],
  ['hillshade', 'Hillshade', 'Relief shading from elevation'],
  ['landcover', 'Land cover', 'Forest, farmland, desert and so on (MODIS IGBP)'],
];
const VIEW: Item[] = [
  ['tilt', 'Tilt', 'Tilt the camera (top-down by default)'],
  ['terrain3d', '3D terrain', 'Raised relief from AWS Terrain Tiles'],
];
const DEV: Item[] = [
  ['engineTerrain', 'Model terrain', "The engine's 0.25 degree terrain classes over the theater"],
  ['stress', 'Stress 6000', 'Developer test: 6000 synthetic moving units with an FPS counter'],
];
// Shown next to the Layers button on a wide map; everything is also in the panel.
const QUICK: (keyof LayerToggles)[] = ['front', 'supply', 'fog'];
const ALL = [...WAR, ...MAP, ...VIEW, ...DEV];

// One Layers button opens a grouped panel at every width; a few war layers also sit beside it as quick
// toggles while the map area is wide enough (CSS container query hides them on a narrow map).
export function MapToolbar() {
  const layers = useStore((s) => s.layers);
  const names = useStore((s) => s.scenario.sides.map((x) => x.name).join('|'));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const onCount = ALL.filter(([k]) => !!layers[k]).length;
  // a click or tap anywhere outside the toolbar closes the panel, focus stays where the user put it
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const flip = (k: keyof LayerToggles) => setLayers({ [k]: !layers[k] } as Partial<LayerToggles>);
  const check = ([k, l, t]: Item) => (
    <label key={k} className="maptools-item" title={t}>
      <input type="checkbox" checked={!!layers[k]} onChange={() => flip(k)} />{l}
    </label>
  );
  const viewAs = (
    <select value={layers.fogSide} onChange={(e) => setLayers({ fogSide: +e.target.value as 0 | 1 })} title="Whose eyes the fog of war uses" aria-label="Fog of war: view as">
      {names.split('|').map((n, i) => <option key={i} value={i}>view as {n}</option>)}
    </select>
  );
  return (
    <div ref={rootRef} className={`maptools${open ? ' open' : ''}`}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); toggleRef.current?.focus(); } }}>
      <button ref={toggleRef} className="maptools-toggle" aria-expanded={open} aria-controls="map-layers" onClick={() => setOpen(!open)}>
        <Icon name="layers" size={14} />Layers <span className="count" aria-label={`${onCount} on`}>{onCount}</span>
      </button>
      {open && (
        <div className="maptools-panel" id="map-layers" role="group" aria-label="Map layers">
          <div className="maptools-group" role="group" aria-labelledby="maptools-war">
            <h3 id="maptools-war">War</h3>
            {WAR.map(check)}
            {layers.fog && <div className="maptools-sub">{viewAs}</div>}
          </div>
          <div className="maptools-group" role="group" aria-labelledby="maptools-map">
            <h3 id="maptools-map">Map</h3>
            {MAP.map(check)}
          </div>
          <div className="maptools-group" role="group" aria-labelledby="maptools-view">
            <h3 id="maptools-view">View</h3>
            {VIEW.map(check)}
          </div>
          <details className="maptools-dev">
            <summary>Developer</summary>
            {DEV.map(check)}
          </details>
        </div>
      )}
      <div className="maptools-quick" role="group" aria-label="Quick war layers">
        {WAR.filter(([k]) => QUICK.includes(k)).map(([k, l, t]) => (
          <button key={k} title={t} className={layers[k] ? 'on' : ''} aria-pressed={!!layers[k]} onClick={() => flip(k)}>{l}</button>
        ))}
        {layers.fog && !open && viewAs}
      </div>
    </div>
  );
}
