// Builds the global 0.25 degree terrain grid used by the engine and the map.
//   land cover : NASA GIBS MODIS Combined IGBP Land Cover 2022, 500 m (public domain)
//   elevation  : AWS Terrain Tiles, Terrarium encoding, zoom 4 (open data, attribution)
//   rivers     : Natural Earth 1:50m rivers and lake centerlines (public domain)
// Output: public/data/terrain/grid.bin  = [class u8 x N][flags u8 x N][elev i16 x N][relief u16 x N]
//         public/data/terrain/grid.json = metadata + per-class counts
//         public/data/geo/rivers.geojson (for the map)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { FLAG_COAST, FLAG_RIVER, GRID_H, GRID_RES, GRID_W, T, TERRAIN_CLASSES, cellIndex } from '../src/engine/terrainClasses';
import { ROOT, Progress, cachedFetch, pool } from './lib/util';

const N = GRID_W * GRID_H;
const OUT = join(ROOT, 'public', 'data');

// IGBP class -> terrain class. Grassland (10) is the Eurasian/N. American steppe and
// prairie in IGBP; savanna (9) is open plains; open shrubland (7) is semi-arid steppe.
const IGBP_RGB: Record<string, number> = {
  '33,138,33': 1, '49,204,49': 2, '152,204,49': 3, '150,250,150': 4, '141,186,141': 5,
  '186,141,141': 6, '245,222,179': 7, '218,235,157': 8, '255,213,0': 9, '240,185,103': 10,
  '71,131,181': 11, '250,239,115': 12, '255,0,0': 13, '153,147,86': 14, '255,255,255': 15,
  '191,191,189': 16, '134,202,227': 17,
};
const IGBP_TO_TERRAIN: Record<number, number> = {
  1: T.forest, 2: T.forest, 3: T.forest, 4: T.forest, 5: T.forest, 6: T.steppe, 7: T.steppe,
  8: T.forest, 9: T.plains, 10: T.steppe, 11: T.wetland, 12: T.cropland, 13: T.urban,
  14: T.cropland, 15: T.ice, 16: T.desert, 17: T.water,
};

// Relief thresholds (m, std-dev of ~10 km samples within a 0.25 deg cell) follow the
// relief-roughness logic of Meybeck et al. 2001, "A new typology for mountains and other
// relief classes", Mountain Research and Development 21(1). See SOURCES.md derived:terrain-class.
const RELIEF_MOUNTAIN = 250;
const RELIEF_HILLS = 90;
const HIGH_PLATEAU = 3000;

async function landCover(): Promise<Uint8Array> {
  // GIBS EPSG:4326 level 3: 512 px tiles of 36 deg, 0.0703 deg/px -> ~3.6 px per cell.
  const level = 3, tileDeg = 36, px = 512;
  const cols = 10, rows = 5;
  const votes = new Uint16Array(N * 18);
  const tiles: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push([r, c]);
  const prog = new Progress('land cover tiles', tiles.length);
  await pool(tiles, 6, async ([r, c]) => {
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual/default/2022-01-01/500m/${level}/${r}/${c}.png`;
    const png = PNG.sync.read(await cachedFetch(url));
    for (let y = 0; y < png.height; y++) {
      const lat = 90 - (r * tileDeg + ((y + 0.5) * tileDeg) / px);
      if (lat < -90) continue;
      for (let x = 0; x < png.width; x++) {
        const lon = -180 + c * tileDeg + ((x + 0.5) * tileDeg) / px;
        const o = (y * png.width + x) * 4;
        const cls = IGBP_RGB[`${png.data[o]},${png.data[o + 1]},${png.data[o + 2]}`];
        if (!cls) continue;
        votes[cellIndex(lat, lon) * 18 + cls]++;
      }
    }
    prog.tick();
  });
  const out = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) {
    let best = 0, bestN = 0, water = 0, total = 0;
    for (let k = 1; k < 18; k++) {
      const v = votes[i * 18 + k];
      total += v;
      if (k === 17) water = v;
      if (v > bestN) { bestN = v; best = k; }
    }
    if (total === 0) continue;
    // A cell is land if at least 40% of its pixels are land, so coasts keep their land cells.
    if (best === 17 && water < total * 0.6) {
      bestN = 0;
      for (let k = 1; k < 17; k++) { const v = votes[i * 18 + k]; if (v > bestN) { bestN = v; best = k; } }
    }
    out[i] = best;
  }
  return out;
}

async function elevation(): Promise<{ elev: Int16Array; relief: Uint16Array }> {
  const z = 4, n = 1 << z, px = 256;
  const sum = new Float64Array(N), sum2 = new Float64Array(N), cnt = new Uint16Array(N);
  const tiles: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tiles.push([x, y]);
  const prog = new Progress('elevation tiles', tiles.length);
  await pool(tiles, 8, async ([tx, ty]) => {
    const png = PNG.sync.read(await cachedFetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`));
    for (let y = 0; y < px; y++) {
      const my = (ty * px + y + 0.5) / (n * px);
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
      for (let x = 0; x < px; x++) {
        const lon = ((tx * px + x + 0.5) / (n * px)) * 360 - 180;
        const o = (y * px + x) * 4;
        const e = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
        const i = cellIndex(lat, lon);
        sum[i] += e; sum2[i] += e * e; cnt[i]++;
      }
    }
    prog.tick();
  });
  const elev = new Int16Array(N), relief = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    if (!cnt[i]) continue;
    const m = sum[i] / cnt[i];
    elev[i] = Math.round(m);
    relief[i] = Math.min(65535, Math.round(Math.sqrt(Math.max(0, sum2[i] / cnt[i] - m * m))));
  }
  // Polar rows outside Web Mercator copy the nearest sampled row.
  for (let r = 0; r < GRID_H; r++) for (let c = 0; c < GRID_W; c++) {
    const i = r * GRID_W + c;
    if (cnt[i]) continue;
    const rr = r < GRID_H / 2 ? 21 : GRID_H - 22;
    elev[i] = elev[rr * GRID_W + c]; relief[i] = relief[rr * GRID_W + c];
  }
  return { elev, relief };
}

async function rivers(flags: Uint8Array) {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_rivers_lake_centerlines.geojson';
  const gj = JSON.parse((await cachedFetch(url)).toString());
  const keep: unknown[] = [];
  for (const f of gj.features) {
    // scalerank <= 6 keeps rivers a campaign would have to cross (Rhine, Danube, Vistula, Dnieper...).
    if (f.properties.scalerank > 6 || f.properties.featurecla !== 'River') continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) {
      for (let k = 1; k < line.length; k++) {
        const [x0, y0] = line[k - 1], [x1, y1] = line[k];
        const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (GRID_RES / 3)) + 1;
        for (let s = 0; s <= steps; s++) flags[cellIndex(y0 + ((y1 - y0) * s) / steps, x0 + ((x1 - x0) * s) / steps)] |= FLAG_RIVER;
      }
    }
    keep.push({ type: 'Feature', properties: { name: f.properties.name, rank: f.properties.scalerank }, geometry: f.geometry });
  }
  mkdirSync(join(OUT, 'geo'), { recursive: true });
  writeFileSync(join(OUT, 'geo', 'rivers.geojson'), JSON.stringify({ type: 'FeatureCollection', features: keep }));
  return keep.length;
}

async function main() {
  const lc = await landCover();
  const { elev, relief } = await elevation();
  const cls = new Uint8Array(N), flags = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let c = lc[i] === 255 ? (elev[i] > 0 ? T.plains : T.water) : IGBP_TO_TERRAIN[lc[i]];
    if (c !== T.water && c !== T.ice && c !== T.urban && c !== T.wetland) {
      if (relief[i] >= RELIEF_MOUNTAIN || elev[i] >= HIGH_PLATEAU) c = T.mountains;
      else if (relief[i] >= RELIEF_HILLS) c = T.hills;
    }
    cls[i] = c;
  }
  for (let r = 0; r < GRID_H; r++) for (let c = 0; c < GRID_W; c++) {
    const i = r * GRID_W + c;
    if (cls[i] === T.water) continue;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr; if (rr < 0 || rr >= GRID_H) continue;
      if (cls[rr * GRID_W + ((c + dc + GRID_W) % GRID_W)] === T.water) { flags[i] |= FLAG_COAST; break; }
    }
  }
  const nRivers = await rivers(flags);
  for (let i = 0; i < N; i++) if (cls[i] === T.water) flags[i] &= ~FLAG_RIVER;

  const buf = Buffer.alloc(N * 6);
  Buffer.from(cls.buffer).copy(buf, 0);
  Buffer.from(flags.buffer).copy(buf, N);
  Buffer.from(elev.buffer).copy(buf, N * 2);
  Buffer.from(relief.buffer).copy(buf, N * 4);
  mkdirSync(join(OUT, 'terrain'), { recursive: true });
  writeFileSync(join(OUT, 'terrain', 'grid.bin'), buf);
  const counts = Object.fromEntries(TERRAIN_CLASSES.map((t, k) => [t, cls.filter((x) => x === k).length]));
  writeFileSync(join(OUT, 'terrain', 'grid.json'), JSON.stringify({
    width: GRID_W, height: GRID_H, resolutionDeg: GRID_RES, classes: TERRAIN_CLASSES,
    layout: ['class:u8', 'flags:u8', 'elev:i16le', 'relief:u16le'], counts, rivers: nRivers,
    sources: {
      landcover: 'NASA GIBS MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual 2022-01-01 (public domain)',
      elevation: 'AWS Terrain Tiles terrarium z4 (https://registry.opendata.aws/terrain-tiles/)',
      rivers: 'Natural Earth 1:50m rivers v5.1.2 (public domain)',
    },
  }, null, 1));
  console.log('terrain counts', counts, 'rivers', nRivers);
}

main().catch((e) => { console.error(e); process.exit(1); });
