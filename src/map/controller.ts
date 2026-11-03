// Imperative owner of the MapLibre map. React (MapView) feeds it state; engine
// frames arrive through the bus without touching React.
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
// MapLibre locates its worker next to its own module URL, which Vite's dep
// pre-bundling moves; point it at the (self-contained) worker file explicitly.
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature } from 'geojson';
import type { Frame, TheaterInfo } from '../engine/protocol';
import { U, UNIT_STRIDE } from '../engine/protocol';
import { GRID_H, GRID_W } from '../engine/terrainClasses';
import type { Scenario } from '../types/scenario';
import type { AppData } from '../ui/data';
import { yearLabel } from '../ui/data';
import { ROLE_LABEL, ROLE_ORDER, STATUS_LABEL } from '../ui/roles';
import type { LayerToggles, MapMode } from '../ui/store';
import { bboxFeature, controlImage, frontFeatures, labelPoint, pointFeatures, supplyFeatures, terrainImage, type Coords4 } from './overlays';
import { MapLegend } from './legend';
import { StressSim } from './stress';
import { FOG_RADIUS_KM, UnitLayer, type Battle } from './unitLayer';

maplibregl.setWorkerUrl(mlWorkerUrl);

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const ATTR = {
  gibs: 'Imagery: <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener">NASA EOSDIS GIBS</a> Blue Marble Shaded Relief + Bathymetry (public domain)',
  dem: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (Mapzen; SRTM, GMTED2010, ETOPO1 et al.)',
  modis: 'Land cover: NASA GIBS MODIS Combined IGBP Land Cover Type, 2022 (public domain)',
  ne: 'Rivers: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
  kg: 'Climate zones (weather odds): Beck et al. 2018, <a href="https://doi.org/10.1038/sdata.2018.214" target="_blank" rel="noopener">Present and future K&ouml;ppen-Geiger climate classification maps at 1-km resolution</a> (CC BY 4.0)',
  hb: 'Historical borders (approximate): <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noopener">aourednik/historical-basemaps</a> (GPL-3.0)',
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
const TRANSPARENT_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PLACEHOLDER_COORDS: Coords4 = [[0, 1], [1, 1], [1, 0], [0, 0]];

function style(): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'mercator' },
    sources: {
      bm: {
        type: 'raster', tileSize: 256, maxzoom: 8, attribution: ATTR.gibs,
        tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
      },
      lc: {
        type: 'raster', tileSize: 256, maxzoom: 8, attribution: ATTR.modis,
        tiles: [`${GIBS}/MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual/default/2022-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
      },
      demHs: {
        type: 'raster-dem', tileSize: 256, maxzoom: 12, encoding: 'terrarium', attribution: ATTR.dem,
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      },
      dem3d: {
        type: 'raster-dem', tileSize: 256, maxzoom: 12, encoding: 'terrarium',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      },
      rivers: { type: 'geojson', data: import.meta.env.BASE_URL + 'data/geo/rivers.geojson', attribution: ATTR.ne },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a1220' } },
      { id: 'bm', type: 'raster', source: 'bm', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.05, 'raster-fade-duration': 150 } },
      { id: 'lc', type: 'raster', source: 'lc', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.5 } },
      {
        id: 'hillshade', type: 'hillshade', source: 'demHs',
        paint: {
          'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#0b0d12',
          'hillshade-highlight-color': 'rgba(255,255,255,0.25)', 'hillshade-accent-color': '#1b1f28',
        },
      },
      {
        id: 'rivers', type: 'line', source: 'rivers',
        paint: {
          'line-color': '#6fb6e6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 1.2, 8, 2.4],
          'line-opacity': 0.85,
        },
      },
    ],
  };
}

/** The front line has no toolbar toggle yet: on unless the store carries
 *  `layers.front === false` (an optional field the shell can add later). */
function showFront(L: LayerToggles): boolean {
  return (L as LayerToggles & { front?: boolean }).front !== false;
}

export interface MapState {
  data: AppData | null;
  scenario: Scenario;
  layers: LayerToggles;
  mapMode: MapMode;
  theater: TheaterInfo | null;
}

export class MapController {
  map: MlMap;
  units = new UnitLayer();
  private loaded = false;
  private state: MapState | null = null;
  private lastFrame: Frame | null = null;
  private labels: maplibregl.Marker[] = [];
  private bordersKey = '';
  private theaterKey = '';
  private terrainKey = '';
  private startsKey = '';
  private hasControl = false;
  private colorKey = '';
  private stress: StressSim | null = null;
  private stressRaf = 0;
  private hud: HTMLDivElement;
  private tip: HTMLDivElement;
  /** Pinned info card of the clicked formation; refreshed every frame. */
  private card: HTMLDivElement;
  private legend: MapLegend;
  private hoverRaf = 0;
  private draftCorner: [number, number] | null = null;
  onBBox: (b: [number, number, number, number]) => void = () => {};
  onStart: (side: 0 | 1, lat: number, lon: number) => void = () => {};

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: style(),
      center: [15, 45],
      zoom: 3.2,
      minZoom: 1,
      maxZoom: 11,
      maxPitch: 70,
      attributionControl: { compact: false, customAttribution: [ATTR.hb, ATTR.kg] },
      dragRotate: true,
      canvasContextAttributes: { antialias: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    this.hud = document.createElement('div');
    this.hud.className = 'map-hud';
    this.hud.style.display = 'none';
    container.appendChild(this.hud);
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    this.tip.style.display = 'none';
    container.appendChild(this.tip);

    this.map.on('load', () => this.onLoad());
    this.map.on('mousemove', (e) => this.onMove(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat));
    this.map.on('mouseout', () => { this.tip.style.display = 'none'; this.units.setHover(null); });
    this.map.on('click', (e) => this.onClick(e.lngLat.lng, e.lngLat.lat, e.point.x, e.point.y));
    this.legend = new MapLegend(container);
    this.card = document.createElement('div');
    this.card.className = 'map-tip map-card';
    this.card.style.display = 'none';
    container.appendChild(this.card);
    window.addEventListener('keydown', this.onKey);
    this.map.on('error', (e) => {
      // tile failures (offline, 404 at the edge of a source) must not spam the console
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
      if (!/Failed to fetch|NetworkError|404|AJAXError/.test(msg)) console.warn('map:', msg);
    });
  }

  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.select(null); };

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.stressRaf);
    // map.remove() clears only MapLibre's own DOM; without this a remount (React
    // StrictMode mounts twice in dev) left stale overlays from the first mount
    for (const el of [this.hud, this.tip, this.card, this.legend.el]) el.remove();
    this.map.remove();
  }

  private onLoad() {
    const m = this.map;
    m.addSource('borders', { type: 'geojson', data: EMPTY_FC });
    m.addSource('theater', { type: 'geojson', data: EMPTY_FC });
    m.addSource('draft', { type: 'geojson', data: EMPTY_FC });
    m.addSource('supply', { type: 'geojson', data: EMPTY_FC });
    m.addSource('starts', { type: 'geojson', data: EMPTY_FC });
    m.addSource('control', { type: 'image', url: TRANSPARENT_PX, coordinates: PLACEHOLDER_COORDS });
    m.addSource('engineTerrain', { type: 'image', url: TRANSPARENT_PX, coordinates: PLACEHOLDER_COORDS });

    m.addLayer({ id: 'engineTerrain', type: 'raster', source: 'engineTerrain', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.55, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } });
    m.addLayer({ id: 'borders-fill', type: 'fill', source: 'borders', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } });
    m.addLayer({ id: 'borders-line', type: 'line', source: 'borders', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } });
    m.addLayer({ id: 'control', type: 'raster', source: 'control', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.32, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } });
    // front line: dark casing, then each side's colour on its own side of the line
    // (frontFeatures orients side 0 on the left; negative line-offset = left)
    const fw = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], 3, a, 8, b] as unknown as number;
    m.addSource('front', { type: 'geojson', data: EMPTY_FC });
    m.addLayer({ id: 'front-casing', type: 'line', source: 'front', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b0d12', 'line-width': fw(5, 9), 'line-opacity': 0.7 } });
    m.addLayer({ id: 'front-0', type: 'line', source: 'front', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c33', 'line-width': fw(1.8, 3.2), 'line-offset': fw(-1.1, -1.9) } });
    m.addLayer({ id: 'front-1', type: 'line', source: 'front', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#36c', 'line-width': fw(1.8, 3.2), 'line-offset': fw(1.1, 1.9) } });
    m.addLayer({ id: 'theater', type: 'line', source: 'theater', paint: { 'line-color': '#f2d16b', 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-opacity': 0.85 } });
    m.addLayer({ id: 'draft', type: 'line', source: 'draft', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'supply-casing', type: 'line', source: 'supply', paint: { 'line-color': '#000', 'line-width': 3.5, 'line-opacity': 0.35 } });
    m.addLayer({ id: 'supply', type: 'line', source: 'supply', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [1, 1.5], 'line-opacity': 0.9 } });
    m.addLayer({ id: 'starts', type: 'circle', source: 'starts', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    m.addLayer(this.units);
    this.loaded = true;
    if (this.state) this.update(this.state, true);
    if (this.lastFrame) this.applyFrame(this.lastFrame, 0);
  }

  // ---------------------------------------------------------------- state sync
  update(s: MapState, force = false) {
    const prev = this.state;
    this.state = s;
    this.legend.setSides(s.scenario.sides.map((x) => ({ name: x.name, color: x.color })));
    if (!this.loaded) return;
    const m = this.map;
    const L = s.layers;
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('lc', L.landcover);
    vis('hillshade', L.hillshade);
    vis('rivers', L.rivers);
    vis('borders-fill', L.borders);
    vis('borders-line', L.borders);
    this.labels.forEach((mk) => { mk.getElement().style.display = L.borders ? '' : 'none'; });
    vis('control', L.control && this.hasControl);
    vis('supply', L.supply);
    vis('supply-casing', L.supply);
    vis('engineTerrain', L.engineTerrain);

    if (force || prev?.layers.terrain3d !== L.terrain3d) {
      m.setTerrain(L.terrain3d ? { source: 'dem3d', exaggeration: 1.5 } : null);
      if (L.terrain3d && m.getPitch() < 30) m.easeTo({ pitch: 55, duration: 800 });
    }
    if (prev && prev.layers.tilt !== L.tilt) m.easeTo({ pitch: L.tilt ? 55 : 0, bearing: L.tilt ? m.getBearing() : 0, duration: 700 });

    const colors: [string, string] = [s.scenario.sides[0].color, s.scenario.sides[1].color];
    if (force || colors.join() !== this.colorKey) {
      this.colorKey = colors.join();
      this.units.setSideColors(colors[0], colors[1]);
      m.setPaintProperty('front-0', 'line-color', colors[0]);
      m.setPaintProperty('front-1', 'line-color', colors[1]);
    }
    const front = showFront(L);
    vis('front-casing', front); vis('front-0', front); vis('front-1', front);

    // theater box: the engine's box while running, else the scenario's
    const bbox = s.theater?.bbox ?? s.scenario.theater.bbox;
    const tKey = bbox.join(',');
    if (force || tKey !== this.theaterKey) {
      this.theaterKey = tKey;
      (m.getSource('theater') as GeoJSONSource).setData(bboxFeature(bbox));
      if (prev) this.fit(bbox);
    }

    // historical borders of the selected snapshots
    const bKey = JSON.stringify([s.scenario.sides.map((x) => [x.members, x.color]), !!s.data]);
    if (force || bKey !== this.bordersKey) { this.bordersKey = bKey; this.drawBorders(s); }

    // engine terrain classes over the theater
    const terrKey = `${tKey}|${L.engineTerrain}|${!!s.data?.terrain}`;
    if (L.engineTerrain && s.data?.terrain && terrKey !== this.terrainKey) {
      this.terrainKey = terrKey;
      const classes = new Uint8Array(s.data.terrain, 0, GRID_W * GRID_H);
      const { canvas, coords } = terrainImage(classes, bbox as [number, number, number, number]);
      (m.getSource('engineTerrain') as ImageSource).updateImage({ url: canvas.toDataURL(), coordinates: coords });
    }

    // start positions
    const starts = s.scenario.sides.flatMap((side, i) => (side.startPositions ?? []).map((p) => ({ ...p, color: colors[i] })));
    const sKey = JSON.stringify(starts);
    if (force || sKey !== this.startsKey) { this.startsKey = sKey; (m.getSource('starts') as GeoJSONSource).setData(pointFeatures(starts)); }

    if (s.mapMode.kind === 'none') { this.draftCorner = null; (m.getSource('draft') as GeoJSONSource).setData(EMPTY_FC); }
    m.getCanvas().style.cursor = s.mapMode.kind === 'none' ? '' : 'crosshair';

    if (prev && (prev.layers.fog !== L.fog || prev.layers.fogSide !== L.fogSide) && !this.stress && this.lastFrame) this.applyFrame(this.lastFrame, 0);
    if (L.stress && !this.stress) this.startStress(bbox as [number, number, number, number]);
    if (!L.stress && this.stress) this.stopStress();
  }

  private drawBorders(s: MapState) {
    const m = this.map;
    this.labels.forEach((mk) => mk.remove());
    this.labels = [];
    const features: Feature[] = [];
    const d = s.data;
    if (d) {
      s.scenario.sides.forEach((side) => {
        for (const id of side.members) {
          const mp = d.borders[id];
          if (!mp || !mp.length) continue;
          features.push({ type: 'Feature', properties: { color: side.color, id }, geometry: { type: 'MultiPolygon', coordinates: mp } });
          const p = labelPoint(mp);
          const snap = d.snapById.get(id);
          if (p) {
            const el = document.createElement('div');
            el.className = 'border-label';
            el.style.borderColor = side.color;
            el.innerHTML = `<b></b><span>approximate border</span>`;
            (el.firstChild as HTMLElement).textContent = snap ? `${snap.name}, ${yearLabel(snap.year)}` : id;
            this.labels.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(m));
          }
        }
      });
    }
    (m.getSource('borders') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }

  fit(b: [number, number, number, number] | number[]) {
    const [w, s, e, n] = b;
    this.map.fitBounds([[w, Math.max(-80, s)], [e, Math.min(82, n)]], { padding: 40, duration: 900 });
  }

  flyTo(lon: number, lat: number, zoom?: number) {
    this.map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 5.5), duration: 900 });
  }

  // ---------------------------------------------------------------- frames
  applyFrame(f: Frame, interpMs: number) {
    this.lastFrame = f;
    if (!this.loaded || !this.state || this.stress) return;
    const L = this.state.layers;
    this.units.setUnits(f.units, f.battles, { enabled: L.fog, side: L.fogSide, radiusKm: FOG_RADIUS_KM }, interpMs);
    if (this.units.selectedId !== null) this.updateCard();
    const colors: [string, string] = [this.state.scenario.sides[0].color, this.state.scenario.sides[1].color];
    const th = this.state.theater;
    if (f.control && th && f.control.length >= th.cols * th.rows) {
      const { canvas, coords } = controlImage(f.control, th, colors);
      (this.map.getSource('control') as ImageSource).updateImage({ url: canvas.toDataURL(), coordinates: coords });
      (this.map.getSource('front') as GeoJSONSource).setData(frontFeatures(f.control, th));
      this.hasControl = true;
      this.map.setLayoutProperty('control', 'visibility', L.control ? 'visible' : 'none');
    }
    if (f.supplyLines) (this.map.getSource('supply') as GeoJSONSource).setData(supplyFeatures(f.supplyLines, colors));
  }

  reset() {
    this.lastFrame = null;
    this.hasControl = false;
    this.units.clear();
    this.select(null);
    if (!this.loaded) return;
    (this.map.getSource('supply') as GeoJSONSource).setData(EMPTY_FC);
    (this.map.getSource('front') as GeoJSONSource).setData(EMPTY_FC);
    this.map.setLayoutProperty('control', 'visibility', 'none');
  }

  // ---------------------------------------------------------------- stress test
  private startStress(bbox: [number, number, number, number]) {
    this.stress = new StressSim(6000, bbox);
    this.hud.style.display = '';
    let frames = 0, windowStart = performance.now(), cpuSum = 0;
    const hist: number[] = [];
    const tick = () => {
      if (!this.stress || !this.state) return;
      const L = this.state.layers;
      const t = performance.now();
      this.stress.step();
      this.units.setUnits(this.stress.units, this.stress.battles, { enabled: L.fog, side: L.fogSide, radiusKm: FOG_RADIUS_KM }, 0);
      cpuSum += performance.now() - t;
      frames++;
      if (frames % 10 === 0 && this.units.selectedId !== null) this.updateCard();
      const now = performance.now();
      if (now - windowStart >= 1000) {
        const fps = (frames * 1000) / (now - windowStart);
        hist.push(fps);
        if (hist.length > 30) hist.shift();
        const stats = {
          fps: Math.round(fps * 10) / 10, cpuMs: Math.round((cpuSum / frames) * 100) / 100,
          units: this.stress.n, instances: this.units.instanceCount, drawCalls: this.units.drawCalls, history: [...hist],
          lod: this.units.lod, lodCpuMs: Math.round(this.units.lodCpuMs * 100) / 100,
        };
        (window as unknown as { __stress: unknown }).__stress = stats;
        this.hud.textContent = `STRESS TEST (synthetic) | ${stats.units} units | ${stats.fps.toFixed(1)} fps | unit CPU ${stats.cpuMs.toFixed(2)} ms/frame | ${stats.drawCalls} draw call | ${stats.lod ? 'compact' : 'full'} symbols`;
        frames = 0; cpuSum = 0; windowStart = now;
      }
      this.stressRaf = requestAnimationFrame(tick);
    };
    this.hud.textContent = 'STRESS TEST (synthetic) | measuring...';
    this.stressRaf = requestAnimationFrame(tick);
  }

  private stopStress() {
    cancelAnimationFrame(this.stressRaf);
    this.stress = null;
    this.hud.style.display = 'none';
    this.units.clear();
    if (this.lastFrame) this.applyFrame(this.lastFrame, 0);
  }

  // ---------------------------------------------------------------- interaction
  private onMove(x: number, y: number, lon: number, lat: number) {
    const mode = this.state?.mapMode;
    if (mode?.kind === 'bbox' && this.draftCorner) {
      const [x0, y0] = this.draftCorner;
      const b: [number, number, number, number] = [Math.min(x0, lon), Math.min(y0, lat), Math.max(x0, lon), Math.max(y0, lat)];
      (this.map.getSource('draft') as GeoJSONSource).setData(bboxFeature(b));
    }
    cancelAnimationFrame(this.hoverRaf);
    this.hoverRaf = requestAnimationFrame(() => this.hover(x, y));
  }

  private hover(x: number, y: number) {
    const i = this.units.pick(this.map, x, y);
    const u = this.units.units;
    this.units.setHover(i < 0 ? null : u[i * UNIT_STRIDE + U.id]);
    this.map.getCanvas().style.cursor = this.state?.mapMode.kind !== 'none' ? 'crosshair' : i >= 0 ? 'pointer' : '';
    if (i < 0) { this.tip.style.display = 'none'; return; }
    const members = this.units.stackMembers(i);
    if (members.length > 1) this.fillStackRows(this.tip, members);
    else this.fillUnitRows(this.tip, i, false);
    this.tip.style.left = `${x + 14}px`;
    this.tip.style.top = `${y + 14}px`;
    this.tip.style.display = '';
  }

  /** Header + key/value rows of formation i into el (tooltip and selection card share it). */
  private fillUnitRows(el: HTMLElement, i: number, card: boolean) {
    const u = this.units.units;
    const o = i * UNIT_STRIDE;
    const side = u[o + U.side] | 0;
    const role = ROLE_ORDER[u[o + U.role] | 0] ?? 'infantry_line';
    const names = this.state?.scenario.sides.map((s) => s.name) ?? ['Side A', 'Side B'];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    el.innerHTML = '';
    const rows: [string, string][] = [
      ['Side', names[side] ?? String(side)],
      ['Type', ROLE_LABEL[role]],
      ['Personnel', Math.round(u[o + U.personnel]).toLocaleString('en-US')],
      ['Strength', pct(u[o + U.strength])],
      ['Supply', pct(u[o + U.supply])],
      ['Morale', pct(u[o + U.morale])],
      ['Status', STATUS_LABEL[u[o + U.status] | 0] ?? '?'],
      ['Tech (weapons)', u[o + U.techEra].toFixed(1)],
    ];
    const h = document.createElement('div');
    h.className = 'tip-head';
    h.textContent = `Formation #${u[o + U.id]} (model state)`;
    if (card) {
      const sw = document.createElement('i');
      sw.className = 'map-card-swatch';
      sw.style.background = this.state?.scenario.sides[side]?.color ?? '#888';
      h.prepend(sw);
      const x = document.createElement('button');
      x.className = 'map-card-close';
      x.title = 'Deselect (Esc)';
      x.textContent = 'x';
      x.onclick = () => this.select(null);
      h.appendChild(x);
    }
    el.appendChild(h);
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.innerHTML = '<span></span><b></b>';
      (r.firstChild as HTMLElement).textContent = k;
      (r.lastChild as HTMLElement).textContent = v;
      el.appendChild(r);
    }
  }

  /** Summary of a stack (formations of one side on one spot): totals, weighted
   *  averages, the commonest types and statuses. Click selects the biggest. */
  private fillStackRows(el: HTMLElement, members: number[]) {
    const u = this.units.units;
    const side = u[members[0] * UNIT_STRIDE + U.side] | 0;
    const names = this.state?.scenario.sides.map((s) => s.name) ?? ['Side A', 'Side B'];
    let pers = 0, str = 0, sup = 0, mor = 0;
    const roles = new Map<string, number>(), stats = new Map<string, number>();
    for (const i of members) {
      const o = i * UNIT_STRIDE;
      const p = Math.max(0, u[o + U.personnel]);
      pers += p; str += u[o + U.strength] * p; sup += u[o + U.supply]; mor += u[o + U.morale] * p;
      const role = ROLE_LABEL[ROLE_ORDER[u[o + U.role] | 0] ?? 'infantry_line'];
      roles.set(role, (roles.get(role) ?? 0) + 1);
      const st = STATUS_LABEL[u[o + U.status] | 0] ?? '?';
      stats.set(st, (stats.get(st) ?? 0) + 1);
    }
    const top = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') + (m.size > n ? ', ...' : '');
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const rows: [string, string][] = [
      ['Side', names[side] ?? String(side)],
      ['Types', top(roles, 2)],
      ['Personnel', Math.round(pers).toLocaleString('en-US')],
      ['Strength (weighted)', pct(pers > 0 ? str / pers : 0)],
      ['Supply (mean)', pct(sup / members.length)],
      ['Morale (weighted)', pct(pers > 0 ? mor / pers : 0)],
      ['Status', top(stats, 2)],
    ];
    el.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'tip-head';
    h.textContent = `${members.length} formations on this spot (model state)`;
    el.appendChild(h);
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.innerHTML = '<span></span><b></b>';
      (r.firstChild as HTMLElement).textContent = k;
      (r.lastChild as HTMLElement).textContent = v;
      el.appendChild(r);
    }
  }

  /** Selects a formation by id (null clears). The card follows it across frames. */
  select(id: number | null) {
    this.units.setSelected(id);
    this.updateCard();
  }

  private updateCard() {
    const id = this.units.selectedId;
    if (id === null) { this.card.style.display = 'none'; return; }
    const i = this.units.selectedUnit;
    this.card.style.display = '';
    if (i >= 0) {
      this.fillUnitRows(this.card, i, true);
      const n = this.units.stackMembers(i).length;
      if (n > 1) {
        const p = document.createElement('div');
        p.className = 'map-card-note';
        p.textContent = `Shares its position with ${n - 1} other formation${n > 2 ? 's' : ''} of its side.`;
        this.card.appendChild(p);
      }
      return;
    }
    // destroyed this turn, or hidden by fog of war: say so instead of freezing stale numbers
    this.card.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'tip-head';
    h.textContent = `Formation #${id}`;
    const x = document.createElement('button');
    x.className = 'map-card-close';
    x.textContent = 'x';
    x.onclick = () => this.select(null);
    h.appendChild(x);
    const p = document.createElement('div');
    p.className = 'map-card-note';
    p.textContent = 'Not on the map now (destroyed or not visible).';
    this.card.append(h, p);
  }

  private onClick(lon: number, lat: number, x: number, y: number) {
    const mode = this.state?.mapMode;
    if (!mode || mode.kind === 'none') {
      const i = this.units.pick(this.map, x, y);
      this.select(i < 0 ? null : this.units.units[i * UNIT_STRIDE + U.id]);
      return;
    }
    if (mode.kind === 'bbox') {
      if (!this.draftCorner) { this.draftCorner = [lon, lat]; return; }
      const [x0, y0] = this.draftCorner;
      this.draftCorner = null;
      const r = (v: number) => Math.round(v * 4) / 4;
      this.onBBox([r(Math.min(x0, lon)), r(Math.max(-85, Math.min(y0, lat))), r(Math.max(x0, lon)), r(Math.min(85, Math.max(y0, lat)))]);
    } else if (mode.kind === 'start') {
      this.onStart(mode.side, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100);
    }
  }
}

export type { Battle };
