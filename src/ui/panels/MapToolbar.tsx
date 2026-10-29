import { setLayers, useStore, type LayerToggles } from '../store';

const ITEMS: [keyof LayerToggles, string, string][] = [
  ['tilt', 'Tilt', 'Tilt the camera (top-down by default)'],
  ['terrain3d', '3D terrain', 'Extruded relief from AWS Terrain Tiles'],
  ['hillshade', 'Hillshade', 'Relief shading from elevation'],
  ['landcover', 'Land cover', 'MODIS IGBP land cover overlay'],
  ['rivers', 'Rivers', 'Natural Earth rivers'],
  ['borders', 'Borders', 'Historical borders of the selected snapshots (approximate)'],
  ['engineTerrain', 'Model terrain', "The engine's 0.25 degree terrain classes over the theater"],
  ['control', 'Control', 'Territory control from the engine'],
  ['supply', 'Supply lines', 'Supply lines from the engine'],
  ['fog', 'Fog of war', 'Hide enemy formations outside own formations’ sight radius (display only)'],
  ['stress', 'Stress 6000', 'Dev: 6000 synthetic moving units with an FPS counter'],
];

export function MapToolbar() {
  const layers = useStore((s) => s.layers);
  const names = useStore((s) => s.scenario.sides.map((x) => x.name).join('|'));
  return (
    <div className="maptools">
      {ITEMS.map(([k, l, t]) => (
        <button key={k} title={t} className={layers[k] ? 'on' : ''} onClick={() => setLayers({ [k]: !layers[k] } as Partial<LayerToggles>)}>{l}</button>
      ))}
      {layers.fog && (
        <select value={layers.fogSide} onChange={(e) => setLayers({ fogSide: +e.target.value as 0 | 1 })} title="View as">
          {names.split('|').map((n, i) => <option key={i} value={i}>view as {n}</option>)}
        </select>
      )}
    </div>
  );
}
