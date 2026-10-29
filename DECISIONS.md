# Decisions

Every open choice made while building, with a one-line reason. Newest at the bottom of each section.

## Stack
- **React 19 + TypeScript 5.9 + Vite 8.** React is the most widely known component framework, so every agent writes it the same way; TypeScript 5.9 instead of 7.x because 7 is the new native compiler and tooling around it is younger.
- **MapLibre GL JS 6** for the map. Open-source WebGL map with raster-dem hillshade and terrain built in, and a custom-layer API for drawing thousands of units in one draw call.
- **uPlot** for live charts. Canvas-based, a few KB, handles thousands of points per series without frame drops.
- **Vitest** for tests, **tsx** to run TypeScript pipeline scripts, **Ajv** for JSON Schema validation of research output.
- **No backend.** Static site as required; all data ships as JSON under `public/data`.

## Data model
- **Every number is an `Est` {low, mid, high, grade, source, note}.** The prompt requires range + grade + source on every number; one shape for all fields keeps the editor and validator generic.
- **Derived numbers cite `derived:<method>`, never a fake URL.** Methods are written out in `data/SOURCES.md`, so a reconstructed value is visibly reconstructed.
- **Unit roles span eras; lethality comes from a tech matrix.** One `infantry_line` role at tech 3 (hoplites) and tech 7 (rifles) lets any era fight any era through one combat model instead of per-era special cases.
- **Tech on a 0..10 scale with documented anchors** (1 early bronze ... 10 2026). A single ordinal scale is needed for cross-era comparison and era-equalized mode; anchors are sourced in `data/mechanics`.
- **Lethality uses Dupuy's Theoretical Lethality Index and dispersion factors.** It is the only published framework that puts swords, muskets, machine guns and aircraft on one quantitative scale, and it is citable.
- **Snapshots are the unit of data, keyed `<nationId>-<year>`** with BCE years negative, as the prompt specifies.
- **Land cover from NASA GIBS MODIS IGBP land cover (500 m) instead of ESA WorldCover.** The WorldCover WMTS (services.terrascope.be) did not answer from this machine (curl exit 92), and the full 10 m WorldCover is terabytes; MODIS IGBP is public domain and coarse enough for 0.25 degree cells.
- **Elevation from AWS Terrain Tiles (Terrarium encoding).** Open data registry, explicit permission for use with attribution, works directly as a MapLibre raster-dem source.
- **Base imagery from NASA GIBS Blue Marble Shaded Relief + Bathymetry.** Public domain, gives the "looking down at the real Earth" look without hotlinking a commercial provider.
- **Historical borders from aourednik/historical-basemaps (GPL-3.0).** Named in the prompt; it is open-licensed, and only the years we need are fetched by the pipeline and simplified. License noted in SOURCES.md.

## Scope
- **Phase 1 slice = 15 snapshots in 5 eras** (classical, medieval, Napoleonic, World Wars, modern) chosen so that 5 of the 10 presets can run in Phase 1.

## Phase 0 review fixes (schema review: PASS WITH FIXES)
- **Force accounting made explicit:** `activePersonnel`, `trainedReserves`, `supportPersonnel`; P roles + support <= active <= mobilizable, enforced by `validate.ts`. Without it researchers double count crews and staff.
- **`includes` + `Coalition`** model containment (British Empire includes India) and alliances, so removing a nation removes it everywhere.
- **`lossReplacement` replaced by `annualCohort` + per-role `production`.** Replacement rate is a model output, not something a researcher can look up.
- **Mechanics `MV` uses low/mid/high like `Est`,** so the editor and sensitivity analysis have one code path.
- **Added mechanics for rating-to-combat conversion, role mobility by tech, range, sieges, weather, role remapping for era-equalized mode, production.** Each gap meant the engine would need an unsourced literal.
- **BattleCase supports ranges, draws, reinforcements and campaign start positions.** Needed for Waterloo, Gettysburg, Tannenberg and campaign backtests.
- **Books citable as `isbn:` / `doi:` with the page in the note.** Engels, Dupuy and Delbrueck are books, not URLs.
- **Historical year numbering, no year 0, half-open eras.** Removes the -480 vs -479 ambiguity.
- **Ratings, tech levels and home defense use written rubrics in SOURCES.md.** Without anchors, two researchers would grade the same army differently.
- **Kept a single `region` per snapshot** (reviewer nit). Search filters by region; a multi-region empire is filed under its core region and its `places` show the rest.
- **Historical borders (GPL-3.0):** the pipeline ships simplified geometry derived from aourednik/historical-basemaps with attribution; the data files stay under GPL-3.0, which allows redistribution, and are noted as such in SOURCES.md.
- **Scenario edits are stored as `Override {snapshotId, path, value}`.** Small enough to put in a share URL and replayable on top of any data version.

## Phase 1 integration
- **Withdrawal threshold = min(doctrine retreatThreshold, 0.9 x effective breakpoint).** Ten doctrine profiles set retreatThreshold at or above the era's rout breakpoint (both researched independently); clamping keeps "withdraw before rout" true without overwriting either researched number.
- **Snapshots without a border polygon get a circle around the capital sized to their researched area.** The basemaps lump Athens, Sparta and Macedon into one "Greek city-states" polygon; a circle is crude but never claims another state's land first.
- **`siege.assaultFactor` multiplies the attacker's loss rate when storming** (researched from Badajoz 1812), not the attacker's power.
- **Phase 2 modern research started before the Phase 1 gate closed.** The schema had held across 13 researched snapshots from 5 eras with no structural change, and research output cannot break the app (invalid files are skipped by the build). Engine work and backtests still gate the Phase 2 historical waves.
- **`foodSurplus` is floored at 0 for net food importers** (Japan, Taiwan, North Korea, Singapore and others), with the import share in the note. A signed field would only matter for blockade starvation of a modern state, which the engine does not model; a separate import-dependency field is the upgrade path if it ever does.
