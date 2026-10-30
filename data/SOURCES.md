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
  (`hb:1938:Germany + hb:1938:Bohemia-Moravia`). Overlapping polygons count once on the map.
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
  there is no agriculture (Vatican City).
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
  profile-specific reason (stated as grade C in the note); the `low` quartile when sources record
  a doctrine of early disengagement (skirmish or delay doctrine, breaking contact, casualty
  conservation, collapse when the commander fell); the `high` quartile when sources record a
  refusal to withdraw (standing orders, holding by drill under heavy loss, fighting to
  destruction). A non-backtest battle that gives the loss at withdrawal with no pursuit, or
  bounds it, overrides or brackets the quartile; the note gives the arithmetic. A profile spanning
  several eras takes the mean of their values. Battles in `data/battles` are backtest cases and
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

- `derived:cohort-from-agegroup` - persons reaching military age per year = (male population x
  share aged 15-19 + female population x share aged 15-19) / 5, World Bank SP.POP.1519.MA.5Y /
  SP.POP.1519.FE.5Y and SP.POP.TOTL.MA.IN / FE.IN.
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
