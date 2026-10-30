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
- **`foodSurplus` is never negative, and a net food importer is not 0.** The field is the share of food production not eaten by the farm population, which is high for any urbanized state whatever its imports. A first rule that floored importers at 0 contradicted that definition and was reversed after the data audit; import dependence goes in the note. The engine reads foodSurplus nowhere yet (pre-modern foraging is not modelled), so neither rule changed a simulation result.
- **`mechanics/modelRules.json` is keyed by the engine's era ids, plus a `napoleonic` key** for the per-era constants. Sources split 1789-1849 from 1850-1914 (Berezina vs Koniggratz, Walcheren vs the Civil War), which the `industrial` era merges; the engine uses `napoleonic` for years before 1850 when present and `industrial` otherwise.

## Validation discipline (after QA round 2)
- **Model behaviour is chosen by correctness, never by backtest score.** A fix that is right but costs passes stays ON and the cost is recorded; three case-construction toggles left OFF for costing a pass are switched ON. The earlier instruction to leave negative-measured fixes OFF was wrong.
- **The gate counts right-reason passes.** A winner pass that QA classifies WRONG does not count toward the 18; PARTLY counts, with its gap documented.
- **No grade D constant may decide a gate case.** Where an engine-internal scale cannot be sourced, the backtest table is reported at the low, mid and high of its range, and a winner that flips across the range counts as unresolved.
- **Constants are not calibrated on backtest cases.** A value derived from a case in `data/battles/` is re-derived from wars outside the set, or the case is marked in-sample.


## Engine round 3
- **A synthesized battle-case start base is not a capital.** `capitalLossShock` fires only for a place a case or snapshot marks as a real capital; no case does today, so the shock never fires in the backtest. The base still anchors cell control and the AI. Before this, a grade-D shock fired whenever a made-up base fell (Stalingrad day 4).
- **A side does not take an attack slot it cannot staff to its doctrine's required ratio.** The assignment loop used to keep pouring every remaining formation into an attack whose need it could never meet, so a defending Iraq 2003 sent 14 of 22 formations at about 1:2.7 against what its own doctrine asks. Unstaffable attack slots are skipped and those formations defend. A floor on the hold slot's need was rejected: it would add an unsourced share-of-army constant.
- **Measurements are taken in clean worktrees at named commits.** A data change landing in the shared tree mid-run mixed into one fix's numbers (`0c8ca1a`); its corrected figures are in `7dce88a` and VALIDATION.md.

## After QA round 4
- **A doctrine's withdraw threshold holds only battlefield evidence of when its formations withdrew.** Casualty conservation, strategic caution and political limits are choices about whether to attack and belong in aggression and the required force ratio; a one-off event (a commander falling) is not doctrine. Profiles placed in a quartile for those reasons go back to the era mid.
- **The doctrine moves the break point both ways.** The 0.9 x breakpoint cap made every high-quartile ("holds") value inert. A formation's break point becomes the doctrine's threshold scaled by the per-seed era draw (bp_era(u) / bp_era(mid)), with withdrawal just before it; no new constant.
- **The attack staffing test is local and uses combat power.** The need is the required ratio times the enemy power at the target, not a whole enemy group, and both sides are measured with the battle model's own power (quality, training, command and the tech factors), not raw weapon weight.
- **The AI's required force ratios become sourced data** (modelRules), reported at low, mid and high, instead of the code constants 3.0 and 1.5.
- **Battle cases and snapshots use the specific doctrine profile where one exists** (the Israeli sides in 1967 and 1973 use idf-1967, not the coldwar-western archetype).

## After the historical data audit
- **`foodSurplus = 1 - a / s`** (a = agricultural employment share, s = calorie self-sufficiency). This is what the definition "share of production not eaten by the farm population" works out to. The modern generator already uses it; historical values that assumed s = 1 keep that assumption only where s cannot be fetched, and say so. Self-sufficiency itself, or a trade balance, is not the field.
- **The Köppen-Geiger archive was fetched once by the pipeline** (Beck et al. 2018, figshare, 68 MiB, CC BY 4.0, md5-checked). Only the 0.5 deg present-day map and its legend are kept in the uncommitted `.cache/`; the committed product is a 259 KB zone grid. Fetching open source data is the pipeline's job under the original brief, as for the basemaps and World Bank series.
- **Phase 3 takes polities of at least 50,000 km²** (about 65 engine cells, enough for a front, a rear and a capital), one snapshot per polity per era at its largest extent. Non-state features are excluded and listed in COVERAGE.md as not modelled: unclaimed land, archaeological cultures, ethnolinguistic and aggregate labels, and the Native-Land-style indigenous territory polygons after 1492, which mark peoples' lands rather than states (named state-like polities such as the Iroquois, Mapuche, Chimu and Muisca are kept). A polity that already has a researched snapshot in the same era is not derived again.
