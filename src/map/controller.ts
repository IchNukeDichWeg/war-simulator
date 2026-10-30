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
import { bboxFeature, controlImage, labelPoint, pointFeatures, supplyFeatures, terrainImage, type Coords4 } from './overlays';
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
    this.map.on('mouseout', () => { this.tip.style.display = 'none'; });
    this.map.on('click', (e) => this.onClick(e.lngLat.lng, e.lngLat.lat));
    this.map.on('error', (e) => {
      // tile failures (offline, 404 at the edge of a source) must not spam the console
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
      if (!/Failed to fetch|NetworkError|404|AJAXError/.test(msg)) console.warn('map:', msg);
    });
  }

  destroy() {
    cancelAnimationFrame(this.stressRaf);
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
    if (force || colors.join() !== this.colorKey) { this.colorKey = colors.join(); this.units.setSideColors(colors[0], colors[1]); }

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
    const colors: [string, string] = [this.state.scenario.sides[0].color, this.state.scenario.sides[1].color];
    const th = this.state.theater;
    if (f.control && th && f.control.length >= th.cols * th.rows) {
      const { canvas, coords } = controlImage(f.control, th, colors);
      (this.map.getSource('control') as ImageSource).updateImage({ url: canvas.toDataURL(), coordinates: coords });
      this.hasControl = true;
      this.map.setLayoutProperty('control', 'visibility', L.control ? 'visible' : 'none');
    }
    if (f.supplyLines) (this.map.getSource('supply') as GeoJSONSource).setData(supplyFeatures(f.supplyLines, colors));
  }

  reset() {
    this.lastFrame = null;
    this.hasControl = false;
    this.units.clear();
    if (!this.loaded) return;
    (this.map.getSource('supply') as GeoJSONSource).setData(EMPTY_FC);
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
      const now = performance.now();
      if (now - windowStart >= 1000) {
        const fps = (frames * 1000) / (now - windowStart);
        hist.push(fps);
        if (hist.length > 30) hist.shift();
        const stats = {
          fps: Math.round(fps * 10) / 10, cpuMs: Math.round((cpuSum / frames) * 100) / 100,
          units: this.stress.n, instances: this.units.instanceCount, drawCalls: this.units.drawCalls, history: [...hist],
        };
        (window as unknown as { __stress: unknown }).__stress = stats;
        this.hud.textContent = `STRESS TEST (synthetic) | ${stats.units} units | ${stats.fps.toFixed(1)} fps | unit CPU ${stats.cpuMs.toFixed(2)} ms/frame | ${stats.drawCalls} draw call`;
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
    if (i < 0) { this.tip.style.display = 'none'; return; }
    const u = this.units.units;
    const o = i * UNIT_STRIDE;
    const side = u[o + U.side] | 0;
    const role = ROLE_ORDER[u[o + U.role] | 0] ?? 'infantry_line';
    const names = this.state?.scenario.sides.map((s) => s.name) ?? ['Side A', 'Side B'];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.tip.innerHTML = '';
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
    this.tip.appendChild(h);
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.innerHTML = '<span></span><b></b>';
      (r.firstChild as HTMLElement).textContent = k;
      (r.lastChild as HTMLElement).textContent = v;
      this.tip.appendChild(r);
    }
    this.tip.style.left = `${x + 14}px`;
    this.tip.style.top = `${y + 14}px`;
    this.tip.style.display = '';
  }

  private onClick(lon: number, lat: number) {
    const mode = this.state?.mapMode;
    if (!mode || mode.kind === 'none') return;
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
