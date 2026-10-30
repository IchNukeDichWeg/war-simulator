# Sources

Every number in `data/` cites either a fetched URL or one of the derivation methods below.
Per-value citations live in the JSON itself (`source` field); this file lists the source
families, their licenses, and the derivation methods.

## Source plan (priority order)

| Domain | Preferred sources | Notes |
| --- | --- | --- |
| Modern population, GDP, urbanization, land area, rail | World Bank Open Data API (CC BY 4.0) | Grade A. Pulled by `data-pipeline/fetch-worldbank.ts`. |
| Modern armed forces personnel, military spending | World Bank (IISS-sourced personnel, SIPRI-sourced spending), SIPRI Milex | Grade A/B. |
| Modern equipment counts | National defence ministries, IISS Military Balance as quoted in Wikipedia articles with the edition named | Grade B. Ranking sites (Global Firepower etc.) only as cross-check, never primary. |
| Nuclear warheads | FAS Status of World Nuclear Forces, SIPRI Yearbook | Grade B (official figures are rare). |
| Historical population | Seshat Global History Databank, McEvedy & Jones (1978) via secondary citations, HYDE 3.2 | Grade B/C. |
| Historical GDP per capita | Maddison Project Database 2023 | Grade B, C before 1000 CE. |
| Historical army sizes | Peer-reviewed / well-regarded military histories | Ancient chroniclers' figures are unreliable and flagged in `note`. |
| 19th-20th c. military | Correlates of War National Material Capabilities v6 | Grade A/B. |
| Doctrine | Military histories, staff-college and service publications | Cited per profile. |
| Mechanics constants | Dupuy (Numbers, Predictions and War; Evolution of Weapons and Warfare), Engels (Alexander the Great and the Logistics of the Macedonian Army), van Creveld (Supplying War), Lynn, US Army FM / ATP logistics planning factors | Cited per constant. |
| Terrain | AWS Terrain Tiles, NASA GIBS (Blue Marble, MODIS land cover), Natural Earth | Open data. |
| Climate | WMO 1991-2020 climate normals (NOAA NCEI accession 0253808), Beck et al. 2018 Koppen-Geiger map (CC BY 4.0) | Weather odds by climate zone, `derived:weather-from-normals`. |
| Historical borders | aourednik/historical-basemaps (GPL-3.0) | Approximate by construction. |

## Citation formats

- Web page you fetched: the URL.
- Printed book or article: `isbn:<isbn>` or `doi:<doi>`, with the page or chapter in `note`.
- Derived value: `derived:<method-id>` from the list below. Nothing else.
- A search-engine snippet is never a source. Ancient chroniclers' army sizes (Herodotus, Arrian,
  medieval chronicles) are not accepted as the `mid` value; when used, the `note` says so and
  the grade is at most C.

## Conventions

- Years: historical numbering, 480 BCE = `-480`, no year 0. Eras are half-open `[start, end)`.
- Money: 2011 international dollars (Maddison Project 2023 convention). Modern World Bank values
  in 2021 PPP are rebased with `derived:ppp-rebase-2011`.
- Modern values: state the reference year in `note` ("asOf 2024").
- Borders: several refs can be joined with ` + ` to union polygons
  (`hb:1200:Hungary + hb:1200:Croatia`, as hungary-1241 uses). Overlapping polygons count once on the map.
- Personnel: `activePersonnel` is the standing, household or salaried force under arms at the
  snapshot date. Feudal, militia and conscript levies that must be called up go in
  `trainedReserves` (the engine calls them up after its mobilization delay); the untrained pool
  beyond that is `mobilizable`. Say in `note` which bodies are counted where.
- `urbanization`: share of population living in settlements of 5,000+ (pre-1800, Bairoch
  convention) or the national statistical definition (modern, as reported by the World Bank).
- `foodSurplus`: share of food production not consumed by the producing agricultural population
  (what can feed towns, armies and stores). Pre-modern values are rough (grade C/D).
  Never negative. A net food importer still has a positive value by this definition (its farms feed
  its towns); state the import dependence in `note` instead of lowering the value. 0 only where
  there is no agriculture (Vatican City). Formula: foodSurplus = 1 - a / s, where a = agricultural
  share of employment and s = food self-sufficiency (domestic production over consumption, in
  calories). The farm population eats a share a of all food, which is a / s of what is produced.
  Where no self-sufficiency figure can be fetched, s = 1 is assumed and the note says so; this
  overstates the value for a heavy importer.
- Role boundaries: `ships_major` = carriers, amphibious assault ships, battleships, cruisers,
  destroyers, frigates (pre-modern: the era's main line warships, e.g. triremes, ships of the line);
  `ships_minor` = corvettes, patrol, missile and mine craft, small galleys; `drones` = reusable
  military UAVs of NATO Group 2 and above (FPV and one-way attack munitions excluded);
  `air_defense` = SAM/AAA batteries (sources that count launchers: about 4-6 launchers per
  battery, conversion stated in the note); `missiles` = ballistic/cruise missile launchers.
- `milSpendShare` for a state at war: mid is the current (wartime) share, low the last
  peacetime share; the note says so.
- Force accounting: see `military` in `src/types/schema.ts`. `forces` is the standing order of
  battle at the snapshot date, P-role counts exclude crews, navy/air personnel, logistics and
  staff (those are `supportPersonnel`).

## Derivation methods

Each `derived:<id>` used in the data must be listed here with its formula.

- `derived:mobilizable-from-ratio` - mobilizable = population x mobilizationRatio (low x low, high x high).
- `derived:gdp-from-pc` - gdp = population x gdpPerCapita.
- `derived:area-from-border` - area of the border polygon computed on the WGS84 ellipsoid by the pipeline.
- `derived:absent-in-era` - the thing did not exist at the snapshot date (rail before 1825,
  nuclear weapons before 1945, air/cyber tech before powered flight/computers). Value 0, grade A.
- `derived:ppp-rebase-2011` - World Bank GDP in 2021 PPP $ x (US GDP deflator 2011 / 2021 =
  0.8306, FRED series GDPDEF annual, 2017=100: 2011 = 91.478, 2021 = 110.130,
  https://fred.stlouisfed.org/series/GDPDEF). Both years must come from the same FRED vintage.
  Approximate: ignores relative-price drift.
- `derived:terrain-class` - terrain class of a 0.25 degree cell: MODIS IGBP majority class,
  then relief override (std-dev of ~10 km elevation samples >= 250 m or mean >= 3000 m ->
  mountains, >= 90 m -> hills), following the relief-roughness typology of Meybeck, Green and
  Vorosmarty (2001), Mountain Research and Development 21(1), doi:10.1659/0276-4741(2001)021[0034:ANTFMA]2.0.CO;2.
- `derived:terrain-from-landcover` - terrain mix of a snapshot: share of `derived:terrain-class`
  cells inside its border polygon.
- `derived:tech-anchor` - tech level read off the anchor table below by matching the
  snapshot's documented equipment to the closest anchor. Note names the anchor used.
- `derived:rating-rubric` - a 0..1 rating (quality, training, commandQuality, cohesion, morale)
  read off the rubric below. Note names the anchor and the evidence.
- `derived:home-defense` - home-field multiplier from the rubric below.
- `derived:regional-analogy` - value copied or scaled from a comparable, better-documented
  polity of the same region and era; note names the analogue and the scaling. Grade C or D.
- `derived:force-from-spending` - modern equipment estimate for a small state with no published
  order of battle: regional median equipment per $bn of military spending x the state's
  spending. Grade D.
- `derived:snapshot-composite` - a snapshot value combined from several cited figures; the note
  shows the arithmetic and names each source. Grade at most C.
- `derived:grt-to-dwt` - merchant fleet deadweight from gross register tons x 1.5 (range 1.3-1.6,
  the usual dwt/grt ratio of cargo ships); the note gives the GRT figure and its source.
- `derived:educated-guess` - no source gives the number; the value is the researcher's informed
  judgement, explained in the note. Always grade D.
- `derived:mech-composite` - a mechanics constant combined from several cited figures; the note
  shows the arithmetic and names each source.
- `derived:breakpoint-quartile` - doctrine `weights.retreatThreshold`. Definition: the share of a
  formation's STARTING strength lost (killed, wounded, captured, missing) at the moment it
  withdraws or breaks, never the battle total including pursuit, prisoners taken after the break,
  mopping-up or campaign attrition. Value read off `modelRules.breakpoint.loserCasualtyShareAtBreak`
  for the profile's era (`napoleonic` for 1789-1849): the `mid` when no source gives a
  profile-specific reason (stated as grade C in the note); a quartile only on battlefield
  evidence of when that army's formations withdrew or held. The `low` quartile when sources
  record tactical early disengagement (skirmish, delay or break-contact doctrine); the `high`
  quartile when sources record tactical holding (standing orders to hold or not to withdraw,
  shown in battles; drill that held formations under heavy loss; fighting to destruction).
  Not evidence for a quartile: casualty conservation or caution about attacking (those belong
  in aggression and the required force ratio), strategic or political limits, and one-off
  events such as a commander falling or fleeing. A non-backtest battle that gives the loss at
  withdrawal with no pursuit, or bounds it, overrides or brackets the quartile; the note gives
  the arithmetic. A profile spanning several eras takes the mean of their values. Battles in `data/battles` are backtest cases and
  never evidence. Doctrine weights are plain numbers (schema), so the basis, method and sources
  go in `weightNotes.retreatThreshold` and the profile's `sources` list.

## Tech level anchors (0..10)

| Level | Year | Weapons | Armor | Ships | Fortification | Logistics | Communications |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | before 3000 BCE | stone, simple bow | none | rafts, canoes | palisade | porters | runners |
| 1 | 2500 BCE | copper/bronze maces, spears | leather, copper helmets | oared riverboats | mudbrick walls | donkeys, carts | runners, signal fires |
| 2 | 1400 BCE | composite bow, war chariot, bronze swords | bronze scale | oared war galleys | stone citadels | ox wagons, depots | couriers |
| 3 | 300 BCE | iron weapons, torsion artillery, sarissa | bronze/iron cuirass, mail | triremes, quinqueremes | ashlar city walls, siege towers | engineered roads, depot system | mounted relay posts |
| 4 | 1250 CE | crossbow, longbow, couched lance, trebuchet | plate-and-mail, barding | cogs, galleys | concentric castles | river transport, granaries | relay horses (yam) |
| 5 | 1600 | arquebus/musket, pike, field cannon | half-armor, cuirass | galleons, ships of the line | trace italienne | magazines, canal transport | couriers, early postal |
| 6 | 1805 | flintlock musket, 12-pdr gun, Gribeauval system | none / cuirass | 74-gun ships of the line | Vauban-type forts | magazines + requisition | semaphore telegraph |
| 7 | 1905 | magazine rifle, machine gun, QF artillery | armored cars, steel helmet (1915) | dreadnoughts, steam | concrete forts, trenches | railways | electric telegraph, telephone |
| 8 | 1943 | tanks, dive bombers, radar-directed AA | rolled homogeneous armor | carriers, radar, submarines | concrete lines (Maginot) | motor transport, rail | radio at company level |
| 9 | 1985 | guided missiles, MBTs w/ FCS, jets | composite armor | nuclear subs, Aegis | hardened shelters | containerised, airlift | satellite comms, data links |
| 10 | 2026 | precision munitions, drones, hypersonics | active protection | networked fleets, USVs | layered air defence | just-in-time, global sealift | networked C4ISR |

ISR, air and cyber use the same years: ISR 7 = aerial reconnaissance (1914), 8 = radar,
9 = satellites, 10 = persistent drone/space ISR; air 7 = 1914 aircraft, 8 = 1943,
9 = 1985, 10 = 5th-generation; cyber 9 = 1990 networks, 10 = 2026 state cyber forces.
Fractions are allowed (Rome 117 CE weapons ~ 3.3).

## Rating rubric (0..1)

| Rating | 0.25 | 0.5 | 0.75 | 1.0 |
| --- | --- | --- | --- | --- |
| quality (equipment vs era best) | obsolete, a generation behind | era-typical | among the era's best | the era's best (e.g. Roman legion kit c. 100 CE, US 2026) |
| training | levies, militia | conscripts with basic training | professional standing army | elite long-service professionals |
| commandQuality | ad hoc, poor coordination | competent staff, average generalship | trained staff system, proven commanders | best-in-era command (Napoleon 1805, Mongols 1241) |
| cohesion | feudal or mercenary host, ethnic splits | national conscript army | professional with strong unit identity | elite, regimental/legionary identity, fights on when surrounded |
| morale | unwilling, unpaid, occupied homeland | average | motivated, recent victories | fanatical or existential defence |

## Home defense rubric (multiplier)

1.0 no home advantage; 1.1 familiar terrain and local supply; 1.2 plus fortified
cities and population support; 1.3 plus deep strategic depth and harsh climate the invader is
not adapted to (Russia, Afghanistan). Note says which applies.

## More derivation methods

- `derived:cohort-from-agegroup` - males reaching military age per year = male population x
  share of males aged 15-19 / 100 / 5, World Bank SP.POP.TOTL.MA.IN and SP.POP.1519.MA.5Y.
  Males only (conscript-pool convention); counting both sexes about doubles it.
- `derived:ports-from-naturalearth` - number of Natural Earth 1:10m ports (scalerank <= 8) inside
  the state's border polygon. Counts ports, not capacity.
- `derived:qjm-terrain-proxy` - a terrain multiplier for which no fetched source gives the
  needed QJM column, filled from the QJM terrain mobility factor rm (Dupuy, Numbers, Predictions
  and War 1985, Table 1, as reproduced in Clark 1989, https://archive.org/details/dimensionalnalys1094526997,
  Fig. 42 p.63). Two uses: (1) `movement.terrain` off-road multiplier = plains FM 101-10 (1941)
  off-road ratio (low 0.32 / mid 0.6 / high 0.83) x rm(class) / rm(flat bare hard, 1.05); check:
  the same formula gives hills 0.46 and mountains 0.29 against the independent FM 101-10 values
  0.5 and 0.3. (2) `combat.terrainMountedFactor` for desert, wetland and urban: the QJM tank
  factor rwi is taken equal to rm, because in the 1972 table (HERO ORALFORE,
  https://archive.org/details/DTIC_AD0902830, App. E Table 2) rwi = rm on all six non-rugged rows
  and lies 0.1-0.2 below rm on the three rugged rows; low = lowest rm in the class minus 0.2.
  Grade at most C: rm measures the mobility of an attacking force in the QJM, not a march rate.
- `derived:weather-from-normals` - `movement.weatherOddsByZone` leaves. For each local season
  (DJF/MAM/JJA/SON, southern stations shifted six months like `seasonOf`) with N days:
  snow = S/N, rain = (P/N) x (1 - snow), mud = k x rain, clear = 1 - rain - mud - snow, where
  P = days with precipitation >= 1 mm and S = days with snow (snow cover >= 1-2 cm where the
  station reports it, else days with snowfall, a lower bound on cover), both from fetched
  climate normals (WMO 1991-2020 normals, NOAA NCEI accession 0253808,
  https://www.nodc.noaa.gov/archive/arc0216/0253808/1.1/data/0-data/, or a Wikipedia climate
  box that cites NOAA or a national service). k = mud/rain of the old Berlin table (spring
  0.517, summer 0.167, autumn 0.6, winter 0.652) is an educated guess, so mud is always grade D
  and clear at most C. mid = the zone's primary station, low/high = min/max over the zone's
  stations. Zone lookup: Beck et al. 2018 Koppen-Geiger 0.5 deg map, doi:10.1038/sdata.2018.214
  (CC BY 4.0), see the note of `movement.weatherOddsByZone.A.spring.clear`.
- `derived:daylight-from-latitude` - the daylight march factor min(1, D / `movement.marchHoursPerDay`).
  D = hours from sunrise to sunset at the theater's centre latitude phi on the sim date:
  declination delta from Spencer, J.W. 1971, "Fourier series representation of the position of
  the sun", Search 2(5):172, the series NOAA's General Solar Position Calculations use
  (https://gml.noaa.gov/grad/solcalc/solareqns.PDF); D = 2 x arccos((cos 90.833 deg - sin phi
  sin delta) / (cos phi cos delta)) / 15 deg per hour, 90.833 deg being NOAA's sunrise zenith
  (refraction plus the solar disc). `src/engine/daylight.ts`.
- `derived:climate-zone-grid` - `public/data/climate/zones.bin`, built by
  `data-pipeline/build-climate.ts` (`npm run data:climate`): Beck, H.E., Zimmermann, N.E.,
  McVicar, T.R., Vergopolan, N., Berg, A. and Wood, E.F. 2018, "Present and future
  Koppen-Geiger climate classification maps at 1-km resolution", Scientific Data 5:180214,
  doi:10.1038/sdata.2018.214; data Beck_KG_V1.zip, doi:10.6084/m9.figshare.6396959 (CC BY 4.0),
  file Beck_KG_V1_present_0p5.tif (1980-2016, 0.5 deg). Codes are read from the archive's
  legend.txt, which the build checks against the 30 classes of the paper's Table 1 and against
  seven interior points (Manaus A, Riyadh and central Sahara BW, Niamey BS, Paris C, Moscow D,
  Greenland ice sheet E); symbols collapse to A, BW, BS, C, D, E. The tif stays in the local
  cache and is not committed.

## Generated modern base snapshots

States without a researched snapshot get one from `data-pipeline/generate-modern.ts` (tag
`auto-base`). Its hard numbers come from the World Bank (grade A/B); its force mix, ratings and
tech are the median of the researched snapshots in the same region (grade D, method
`derived:regional-analogy` or `derived:force-from-spending`). Every such value names the
analogues in its note.

## Phase 3 derivation inputs

`data/reference/phase3-inputs.json` holds the researched inputs of the Phase 3 builder, which
derives a low-confidence snapshot for every remaining historical-basemaps polity from its polygon
area, centroid region and year. Keys are the basemap file years from 3000 BCE to 1994 (`bc1` =
-1); between keys interpolate linearly (log-linearly for density). Region = the project
`RegionId` of the centroid; `meta.regionCountries` lists the modern countries (ISO3) summed into
each region: `data/nations.json` region where the nation exists, else the World Bank mapping of
`data-pipeline/generate-modern.ts`, plus Greenland in `north_america`. Sources, all fetched
2026-10-30:

- Population: OWID long-run population, https://ourworldindata.org/grapher/population
  (HYDE 3.3 for 10,000 BCE-1799, Gapminder v7 1800-1949, UN WPP 2024 from 1950). The HYDE
  portal at Utrecht is behind a bot check and was not used directly.
- Land area: https://ourworldindata.org/grapher/land-area-km (FAO via World Bank), fallback
  `data/raw/worldbank.json`. Countries with neither (Taiwan, Western Sahara, Kosovo, small
  territories) are left out of both numerator and denominator.
- GDP per capita: Maddison Project Database 2023 via
  https://ourworldindata.org/grapher/gdp-per-capita-maddison-project-database (2011 int$).
  Before 1820 only 35 country series exist, most from 1500 on; before 1000 CE only Italy, Greece,
  Spain, Portugal, France, Belgium, Switzerland, Turkey, Egypt, Iraq, Iran, Israel, Jordan,
  Tunisia (all at 1 CE) and Japan (730).
- Urban share: HYDE 3.5 via https://ourworldindata.org/grapher/urbanization-last-500-years.
- Technology adoption: Comin, Easterly and Gong, "Was the Wealth of Nations Determined in
  1000 B.C.?", NBER w12657, https://www.nber.org/system/files/working_papers/w12657/w12657.pdf
  (Table 4, sec. 2) and its data appendix https://m.nber.org/data-appendix/w12657/appen.pdf
  (published as doi:10.1257/mac.2.3.65). The country-level data file needs an openICPSR login
  and was not used.

Methods:

- `derived:hyde-region-density` - persons/km2 = sum of the region's country populations at the
  year / sum of their modern land areas. Basemap years between HYDE time steps (1000-year steps
  BCE, 100-year steps to 1700, 10-year to 1800) are log-linear between the bracketing steps.
  Total land includes deserts, ice and unclaimed land, so this is a LOWER BOUND on the density
  of state territory. HYDE also gives cropland and agricultural area, but density over
  agricultural land overstates state density 10-20x for large polities (China 1 CE: 6 /km2 of
  land, 96 /km2 of agricultural land, Han Empire snapshot 10 /km2), so it is not used.
  Band +/-50% (BCE), 40% (1-1499), 30% (1500-1799), 15% (1800-1949), 5% (1950+): judgement.
- `derived:state-density-factor` - corrects the regional lower bound to state territory, fitted
  on the researched snapshots (not `auto-base`): ln(snapshot population / area / regional
  density at the snapshot year) = intercept + slope x ln(areaKm2) + regionOffset. Pre-1991, 133
  snapshots: intercept 6.73, slope -0.414 +/- 0.041, residual sd 0.80 (1.07 without the area
  term), so a 10,000 km2 polity is ~18x and a 1M km2 empire ~2.7x its regional density.
  Region offset = median residual where the region has 5+ snapshots (south_asia -1.25,
  europe +0.17, mena +0.22, east_asia -0.08, north_america +0.32), else 0. A separate fit on the
  81 researched 1991+ snapshots serves the 1994 map. Population mid = A x regional density x
  exp(intercept.mid + slope.mid x ln A + offset.mid); low/high use intercept.low/high, which
  carry the pooled residual quartiles (offset and slope stay at mid). Clamp A to the fitted
  range (2,550 to 22.4M km2).
  Grade C at best: the targets are themselves B/C estimates.
- `derived:maddison-region-weighted` - population-weighted mean (OWID population) of the
  Maddison 2023 country values in the region. A country counts at a year when it has a value
  there, or a linear interpolation between observations at most 1,000 years apart (60 from
  1820), or an observation within 100 years (pre-1500), 50 years (1500-1819) or 5 years (1820+).
  Settler-enclave series are dropped where they misrepresent the territory's population (USA
  before 1800, South Africa before 1820). Coverage = covered population / regional population,
  stated in each note. Grade: from 1820 B at >= 70% coverage, else C; before 1820 C at >= 30%,
  else D; nothing below 10% is used. From 1820 a region under 10% takes the Maddison regional
  average (Sub Saharan Africa, Latin America, MENA, South and South East Asia, East Asia,
  Western offshoots), grade C. Central Asia 1860-1972: the five ex-Soviet states take the USSR
  series x 0.96 (their 1973 population-weighted ratio to the USSR), grade D, band 0.5x/1.1x.
  Low/high = population-weighted quartiles of the country values, at least +/-10%; +/-25% with
  fewer than 3 countries.
- `derived:maddison-hold` - a region and year without 10% coverage takes the value of the
  nearest basemap year that has country coverage, preferring years before 1820 for years before
  1820 (Malthusian-stagnation assumption); a region with no country coverage before 1820 holds the
  Maddison regional 1820 benchmark (Sub-Saharan Africa: 1,188, which equals the Cape Colony
  value and likely overstates the region). Central Asia before 1860 instead takes the lowest of
  mena, south_asia and east_asia at that year (`derived:regional-analogy`). Grade D, band +/-30%.
- `derived:hyde-region-urban` - HYDE 3.5 urban population share, population-weighted over the
  region. HYDE's urban definition is its own model, not the Bairoch 5,000+ convention of the
  snapshots, so this is a regional cross-check; `eraPeerRatios.urbanization` is the default.
  Grade C (B from 1950), band -40%/+50%.
- `derived:era-peer-median` - median of a ratio over the researched snapshots of one era
  (`auto-base` excluded), low/high = first and third quartile; the note gives the snapshot count.
  Used for activePersonnel / population, mobilizable / population and urbanization, per era and
  per era x region where the cell has 3+ snapshots. Grade C with 10+ snapshots, else D.
- `derived:tech-anchor-default` - default tech level per field: the Tech level anchors above as
  a piecewise-linear curve (level 0.5 at 3000 BCE, 1 at 2500 BCE, 2 at 1400 BCE, 3 at 300 BCE,
  4 at 1250, 5 at 1600, 6 at 1805, 7 at 1905, 8 at 1943, 9 at 1985, 10 at 2026). Air is 0
  before 1911 and cyber 0 before 1990 (`derived:absent-in-era`); cyber from 1990 = 9 + (year -
  1990) / 36. This is the frontier, so it overstates most polities. Grade D, band +/-0.3.
- `derived:tech-regional-cap` - regional lag as a cap: tech = min(default, cap) for the regions,
  years and polity types listed in `tech.regionalCaps`. Caps come from Comin, Easterly and Gong
  (above): the Americas had no bronze or iron weapons, wheel, draft animals, ocean-going armed
  ships or paper before contact (cap weapons 1, armor 1, ships 0.5, logistics 0.5,
  communications 1 to 1492, and for indigenous polities to 1900 at grade D); Oceania has the
  lowest adoption of any continent in all three periods (Table 4: 0.20 / 0.17 / 0.12 against
  Europe 0.66 / 0.88 / 0.87; caps 0.5-1 to 1783); Sub-Saharan Africa had iron but no steel or
  firearms in 1500, no wheel and no ocean ships (cap weapons 3.5, armor 3, ships 2, logistics 1
  from 500 to 1500; ships and logistics for indigenous polities to 1880 at grade D); China used
  no iron before the 6th century BCE (east_asia weapons cap 2.5 to 600 BCE). A cap the source
  states directly is grade C; one inferred from it is grade D. No other region gets a lag.

Doctrine defaults per region x era (`doctrine` in the JSON) pick an `archetype-*` profile, with
a one-line reason each, mostly following the researched snapshots of that cell. For the Americas
and Oceania before 1800 the default is for indigenous polities; colonial polygons should take
their metropole's profile.

How `data-pipeline/generate-phase3.ts` applies these inputs (tag `phase3`, one file per polity
of `data/reference/phase3-polities.json`, minus polities with a same-name snapshot in the same era):

- Habitable land: an engine grid cell (0.25 deg, `public/data/terrain/grid.bin`) inside the
  border that is land (not water) and outside Koppen-Geiger zone E (polar: ET, EF) on the Beck
  et al. 2018 grid the engine already reads (`public/data/climate/zones.bin`, 0.5 deg,
  doi:10.1038/sdata.2018.214). Habitable share h = habitable cell area / all cell area;
  habitable area A_h = A x h.
- Region: the inputs' region rule read off the polygon, as the region holding most of the
  polity's people: each habitable cell takes the region of its Natural Earth country
  (`meta.regionCountries`), weighted by cell area x that region's density at the year. Equal to
  the centroid's region except where a polygon spans regions (Denmark-Norway with Greenland).
- Capital and places: one interior point, the polygon cell nearest the area-weighted centre of
  its main-region cells. Not a documented capital or city; the snapshot note says so.
- Area: `derived:area-from-border`, grade C (basemap borders are approximate).
- Population, first choice: `derived:country-population-match`. The polity takes the
  population of one modern country when they overlap mutually by at least 70%: the country
  holds at least 70% of the polity's habitable land and the polity holds at least 70% of the
  country's (both on the engine grid; all land instead of habitable land when the polity has
  no habitable cell; only cells inside a Natural Earth 50m country count, so a one-cell
  coastline difference does not decide the match). The value is the country's OWID population
  (https://ourworldindata.org/grapher/population, current borders: HYDE 3.3 to 1799, Gapminder
  v7 1800-1949, UN WPP 2024 from 1950; fetched by the pipeline as CSV) at the polity's year,
  log-linear between observations (1 BCE reads OWID year 0); no value outside the series. Band
  and grade are those of the inputs' `populationDensity` at that year, which sums the same
  series. 269 of 904 polities match (Libya 1960 LBY, Greenland GRL, Iceland ISL, Saudi Arabia
  SAU, Denmark DNK).
- Population, otherwise: `derived:state-density-factor` with A_h in place of A (in the area term and the
  clamp), then bounded by the region's total population at the year: each of low/mid/high is
  at most the regional density (low/mid/high) x the regional land area that the density's input
  note states ("<people> over <X>M km2"), so no polity exceeds its region. Grade at most C.
- GDP per capita, tech and doctrine: the formulas above; gdp = `derived:gdp-from-pc`. Polity type for the indigenous-only tech caps and the
  doctrine exceptions: colonial (SUBJECTO differs, or a colonial name), settler republic,
  post-independence American state (a states.json name), else indigenous inside the caps'
  windows (Americas to 1900, Sub-Saharan Africa to 1880, Oceania to 1913) and plain state
  outside them. In the Americas and Oceania the pre-1914 doctrine defaults are written for
  indigenous polities, so colonial, settler and successor polities there take the European
  default of the era (the north_america and latin_america industrial defaults already describe
  their post-independence states).
- `derived:era-peer-median`, same pool rule as `eraPeerRatios` (the era x region cell with 3+
  researched snapshots, else the era), also fills every field the inputs do not give, grade D:
  supportPersonnel and trainedReserves per active; P-role shares of combat personnel (active -
  support; a role is fielded when half the pool fields it; shares scaled to sum 1 when the
  medians exceed it); platforms per active soldier; per-role quality and training;
  commandQuality, cohesion, morale; milSpendShare, industrialShare, foodSurplus; annualCohort
  and draftAnimals per person; roadKm and railKm (from 1825) per km2; majorPorts per km2 and
  merchantTonnage per $ GDP (0 without sea access); supplyRangeKm;
  wartime production per $ GDP for fielded platform roles. A value scaled by a peer ratio uses
  low x first quartile and high x third quartile. Personnel shares from `eraPeerRatios` are
  applied to the population the same way and graded D: the analogy, not the input, dominates.
- Role availability (`derived:role-availability`):
  - Horses: no horses before contact, for every polity: the Americas before 1493 and Oceania
    before 1788. There cavalry_heavy, cavalry_light and chariots are not fielded and
    draftAnimals is 0, grade C, sourced to the fetched pages: horses became extinct in the
    Americas about 8,000-12,000 years ago and were reintroduced by the Spanish from 1493
    (https://en.wikipedia.org/wiki/Horses_in_the_United_States, also
    https://en.wikipedia.org/wiki/Evolution_of_the_horse); the first horses reached Australia
    with the First Fleet in 1788 (https://en.wikipedia.org/wiki/Brumby). The inputs' cap note
    (Comin, Easterly and Gong) adds no draft animals of any kind in the Americas before contact.
    Llamas are pack animals with no sourced count and are not counted. After contact horses
    spread at different dates per people (the Mapuche, Comanche and Lakota became horse
    peoples); that is not modelled per people, so post-contact polities take the peer pool.
    The cavalry share of combat personnel goes to the remaining personnel roles in proportion,
    so their total share stays the peer total.
  - Ships: naval roles (ships_major, ships_minor, submarines), majorPorts and merchantTonnage
    only with sea access: a border cell, or one of its 4 neighbours, is a sea cell. Sea = an
    engine water cell connected (8-neighbour, through water cells) to a cell the Beck grid marks
    as sea (value 0). Beck classifies lakes as land climate, so the Caspian, Aral, the Great
    Lakes, Victoria and Baikal are not sea, and a polity on their shores alone has no ships.
    8-neighbour links keep a river estuary one diagonal step wide (St Lawrence below Quebec)
    connected.
  - No other region-specific role rule: a role is fielded when half the peer pool fields it.
- Notes: each value's note is a reference (the input path and year, or the peer pool) plus
  the polity's own numbers; the formulas live here and the full input notes in
  `phase3-inputs.json`.
- Known limits:
  - Without a country match the density formula still applies, and desert counts as habitable
    (zone B is not E). Polygons that are a fragment or a superset of a modern country keep
    regional densities far above plausible values: the 1945 Libya pieces (Cyrenaica 21M, Fezzan
    16M, Tripolitania 10M), Western Sahara 1945/1994 (11M/15M; the 1994 polygon is 63% Moroccan
    land), Arabia 1878 (18M, 68% Saudi), Emirate of Bin Shal'an 1920 (17M), Xixia 1100 (21M),
    Air 1783 (5M), Kalmar Union 1500 (11M). Gridded population (HYDE count grids) would fix
    these; the HYDE portal was behind a bot check when the inputs were researched.
  - A match to one country drops the rest of a union: Denmark-Norway 1783/1800 match Norway
    (0.8-0.9M) and leave out Denmark.
  - The state-density factor makes small habitable areas dense (exp(-0.414 ln A_h)) where no
    country matches.
  - Sub-Saharan cavalry (Asante and other forest-zone states) comes from the peer pool; no
    fetched source was applied to it.
