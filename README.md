# Multi-Era War Simulator

A browser app that pits states from any era against each other (Rome in 117 against Spain in 2026,
the Mongols in 1241 against Napoleonic France, NATO against Russia) on a real-world map. Each side is
built from researched nation snapshots: population, economy, force mix, technology and doctrine,
every value with a source and a confidence grade (A to D). A deterministic day-step engine runs in a
Web Worker and models movement over terrain, supply, combat, morale, weather and victory conditions;
the UI (React, MapLibre) shows the units, the front, the statistics and the reasons for the outcome.

The output is a model, not a prediction. A banner in the app says so, and the engine is checked
against 24 historical battles (see [VALIDATION.md](VALIDATION.md)).

## Requirements

- Node.js 22.12 or newer. `package.json` declares no `engines` field; the floor comes from the
  dependencies (Vitest 5 needs `^22.12.0 || ^24.0.0 || >=26.0.0`, Vite 8 needs `^20.19.0 || >=22.12.0`).
  Developed and checked on Node 26.5.0 with npm 11.17.0.
- A browser with WebGL for the map.
- Network access only for `npm ci` and for the data pipeline's first run. The built runtime data in
  `public/data/` is committed, so the app runs without the pipeline.

## Install

```sh
npm ci
```

npm 11 may warn that `esbuild` and `fsevents` have install scripts not covered by `allowScripts`.
Everything below works without running them.

## Dev server

```sh
npm run dev
```

Opens on http://localhost:5173 (Vite's default; pass `-- --port N` to change it). Pick a scenario
from the **Presets** tab and press **Run**, or build one in the **Scenario** tab.

## Build and preview

```sh
npm run build      # tsc --noEmit, then vite build into dist/
npm run preview    # serves dist/ on http://localhost:4173
```

The build takes about 2 s. `dist/` is about 32 MB, of which 30 MB is the runtime data copied from
`public/data/`; the JavaScript is one 1.45 MB main chunk (417 kB gzipped), a 102 kB engine worker
and the MapLibre worker. Vite warns about the chunk size; that is expected. The build uses relative
paths (`base: './'`), so `dist/` can be served from any subdirectory.

## Tests

```sh
npm test           # vitest run: 12 files, 42 tests, about 3 s
npm run typecheck  # tsc --noEmit, about 1 s
```

The tests cover engine invariants (no NaN, no negative strength, personnel conservation), determinism,
the worker protocol, performance budgets, the historical battle cases, and a guard that fails when
`public/data/battles.json` or `mechanics.json` is stale against `data/`.

## Data pipeline

Research lives in `data/` (raw snapshots, doctrine, mechanics constants, battle cases). The pipeline
turns it into the runtime files in `public/data/`. You only need it after changing `data/` or to
re-fetch the upstream sources.

Every download goes through a cache in `.cache/` (gitignored), keyed by URL, so a second run is
offline and reproducible. Delete `.cache/` to fetch again.

Run the steps in this order (later steps read earlier outputs: the terrain grid feeds the modern,
Phase 3 and build steps, the climate grid feeds Phase 3):

| Order | Command | What it does | Network (first run) | Time, warm cache (measured) |
| --- | --- | --- | --- | --- |
| 1 | `npm run data:terrain` | Global 0.25 deg terrain grid from NASA GIBS MODIS land cover, AWS Terrain Tiles elevation and Natural Earth rivers. Writes `public/data/terrain/` and `public/data/geo/rivers.geojson`. | Yes: 307 requests, 20 MB | 1.6 s |
| 2 | `npm run data:climate` | Koppen-Geiger climate zone grid (Beck et al. 2018). Writes `public/data/climate/`. | Yes: one 71 MB zip from figshare, md5-checked; two entries kept in `.cache/beck/`, the zip deleted | 0.2 s |
| 3 | `npm run data:worldbank` | World Bank indicators (population, GDP, urbanization, armed forces, military spending, farm employment, ...) for every country. Writes `data/raw/worldbank.json`. | Yes: 18 requests, 1.0 MB | 0.2 s (cold: 1.4 s measured) |
| 4 | `npm run data:modern` | Regenerates the `auto-base` 2026 snapshots for states without a researched one, from the World Bank data plus regional medians. Never touches researched files. Writes `data/raw/snapshots/`. | Yes: 2 Natural Earth files, 1.1 MB | 0.7 s |
| 5 | `npx tsx data-pipeline/phase3-enumerate.ts` | Phase 3 step 1 (no npm script yet): lists historical-basemaps polities that have no snapshot. Writes `data/reference/phase3-polities.json`. | Yes: the historical-basemaps world files (shared with step 7) | 0.9 s |
| 6 | `npx tsx data-pipeline/generate-phase3.ts` | Phase 3 step 2 (no npm script yet): derives a low-confidence `phase3` snapshot per enumerated polity. Writes `data/raw/snapshots/`. | Yes: OWID population CSV and Natural Earth countries, 4.7 MB | 1.4 s |
| 7 | `npm run data:validate` | Schema and cross-field checks over everything in `data/`. Exits non-zero on any error. `npm run data:validate -- --quiet` prints only the summary. | No | 0.5 s |
| 8 | `npm run data:build` | Builds `public/data/` (snapshots, per-era Phase 3 files, borders, doctrines, mechanics, battles, presets, coalitions). Files that fail validation are skipped with a message. | Yes: historical-basemaps world files and Natural Earth countries | 51 s (border simplification of about 1,240 polygons) |
| 9 | `npm run data:coverage` | Rewrites `COVERAGE.md` from `data/raw/snapshots/`. | No | 1.0 s |

Warm-cache times were measured on an Apple M5 Pro, Node 26.5.0, on a copy of the repository. First-run
(cold) times were not measured except for the World Bank step; they are dominated by the download
volumes listed, which come from the URLs in the code and the size of the cached responses. The
historical-basemaps and Natural Earth country files for steps 5 and 8 total about 64 MB.

The pipeline rewrites tracked files (`data/raw/snapshots/`, `data/nations.json`, `public/data/`,
`COVERAGE.md`). Review `git diff` after a run.

## Headless scripts

### Backtest

Runs every historical battle case in `public/data/battles.json` through the engine and prints, per
case, how often the historical winner won, the model loss ratio against the historical one, and the
duration against the historical one, then the VALIDATION.md criteria counts.

```sh
npx tsx scripts/backtest.ts
```

| Flag | Meaning |
| --- | --- |
| `--seeds N` | Seeds per case (default 20). |
| `--bp-quantile q1,q2,...` | Runs the whole set once per value, with every morale breakpoint drawn at that quantile of its range (0 = low, 0.5 = mid, 1 = high). Values must be in [0, 1]. Prints the criteria counts per value. |
| `--ratio-quantile q1,q2,...` | Same, for the AI's required force ratios. |
| `--sweep <mechanics.path> v1,v2,...` | Sets one mechanics value (an uncertain value's mid, or a plain number) to each listed value in turn and prints the criteria counts. Nothing is written to disk. |
| `--only id1,id2` | Restricts the run to these battle case ids. |
| `--data DIR` | Reads another data directory instead of `public/data`. |
| `--json FILE` | Writes the per-case rows as JSON (default mode only). |

The default run (24 cases x 20 seeds) takes about 3 s; `--bp-quantile 0,1 --seeds 1` takes under 1 s.

### One scenario

```sh
npx tsx scripts/run-scenario.ts --preset germany-vs-france-1940 --seed 7
```

Runs one preset (`--preset ID`), a scenario file (`--file F`) or an ad-hoc matchup
(`--a SNAP --b SNAP --bbox w,s,e,n` with optional `--month`, `--tech native|equalized`, `--eq N`) and
prints the winner, the end reason, per-side statistics and the reasons for the outcome. `--seed`,
`--days` and `--data DIR` override the scenario; `--events` prints the event log. A preset runs in
well under 10 s.

## Project layout

```
src/
  engine/        simulation core, run in a Web Worker (worker.ts); deterministic per seed
  map/           MapLibre controller, unit layer, overlays, dev stress test
  ui/            React app, panels, store, engine bridge, honest-limits page
  types/         shared types: snapshot schema, mechanics, scenario
  styles/
data/            research input: raw snapshots, doctrine, mechanics, battles, presets, schema,
                 SOURCES.md, RESEARCH_BRIEF.md
data-pipeline/   fetch, generate, validate and build scripts (see above)
public/data/     built runtime data the app loads (committed)
scripts/         headless backtest and scenario runner
tests/           Vitest suites (engine, data, stale-build guard) and fixtures
```

## Documentation

- [ENGINE.md](ENGINE.md): the engine model, rule by rule.
- [VALIDATION.md](VALIDATION.md): backtest criteria, results, sensitivity analysis and verdicts.
- [COVERAGE.md](COVERAGE.md): which nations, snapshots and eras exist, with confidence per snapshot (generated).
- [DECISIONS.md](DECISIONS.md): design decisions and their reasons.
- [data/SOURCES.md](data/SOURCES.md): source families, licences, citation rules and derivation methods.
- [data/RESEARCH_BRIEF.md](data/RESEARCH_BRIEF.md): how to research and add a snapshot.

## Licences

**Code.** The repository has no licence file and `package.json` declares none, so no licence is
granted for the code yet.

**Data.** The runtime data includes material derived from third-party datasets under their own
licences. The main ones (full list in [data/SOURCES.md](data/SOURCES.md)):

- Historical borders: [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps),
  **GPL-3.0**. `public/data/borders.json` and the Phase 3 snapshots are derived from it.
- Modern population, economy and armed-forces indicators: World Bank Open Data, **CC BY 4.0**.
- Climate zones: Beck, H.E. et al. 2018, "Present and future Koppen-Geiger climate classification maps
  at 1-km resolution", Scientific Data 5:180214, doi:10.1038/sdata.2018.214, **CC BY 4.0**.

Terrain comes from NASA GIBS MODIS land cover and Natural Earth (public domain) and AWS Terrain Tiles
(open data, attribution required); the map shows the attributions.

## Known limits

Read the in-app **Honest limits** page (button in the top bar) before drawing conclusions from a run:
it lists the confidence grades of the loaded data, what the model can and cannot say, and the weakest
data. [VALIDATION.md](VALIDATION.md) records where the engine misses the historical battles and by
how much.
