# Engine

How the war model works. Every constant named here in `code font` lives in
`public/data/mechanics.json` (built from `data/mechanics/*.json`) with a range, a
grade and a source. The engine contains no unsourced real-world numbers.

The output is a model, not a prediction. Results are scenarios under stated
assumptions.

## 1. Overview

- Runs in a Web Worker (`src/engine/worker.ts`). The UI sends a `Scenario`, the
  worker streams `Frame`s back (`src/engine/protocol.ts`).
- Deterministic given a seed: one seeded RNG (`mulberry32`/`sfc32`) owned by the
  run; no `Math.random`, no wall-clock, iteration orders fixed (arrays, never
  object-key order of computed keys).
- Daily time step. Battles sub-step by hour inside a day.
- Layers, in order each day: weather -> production/mobilization -> command AI
  (orders, with delay) -> movement -> naval and air war -> tactical resolution
  -> logistics and attrition -> morale -> control and victory check -> frame.
  As built (`src/engine/sim.ts`): weather -> production -> AI -> movement ->
  battle detection -> naval -> air -> tactical resolution -> siege -> logistics,
  attrition and daily morale -> control -> nuclear -> victory. Naval and air run
  after battle detection so air support can be allotted to the day's battles.
- Every loss is booked under a cause (`LossCause`) and every battle records the
  modifiers that decided it, which feeds the result explanation.

## 2. Scenario setup

1. **Expand sides.** Each side lists snapshot ids. `excluded` nationIds are
   removed; if a remaining snapshot `includes` an excluded nation, that nation's
   share is removed from it (scaled by population share when only the total is
   known, documented as an approximation).
2. **Overrides** (`Override {snapshotId, path, value}`) are applied to a deep
   copy of the snapshots.
3. **Tech mode.** `native`: own tech. `equalized`: every tech category of every
   member set to `equalizedTech`, and roles that do not exist at that level are
   converted with `roleRemap` (chariots -> cavalry_light at tech >= 4, etc.).
   `timeslice` is the UI picking a different snapshot year per side; the engine
   treats it as native.
4. **Theater grid.** The theater bbox is cut from the global 0.25 deg terrain
   grid. If it has more than ~20,000 cells, cells are merged k x k (majority
   terrain, max relief, any-river) until it fits. Square lat/lon grid with 8
   neighbours; distances are great-circle km between cell centres.
5. **Initial control.** Each member's border polygon is rasterised onto the
   theater grid (cell centre in polygon). Unclaimed land is neutral.
   Members without a polygon (`territory.border` "none") claim the land cells
   within sqrt(`areaKm2`/pi) km of their capital, nearest first, never taking a
   cell another member's polygon claimed; a setup warning says so. Backtest
   campaigns split control by nearest start position instead.
6. **Commitment and power projection.** For each member, the share of its forces
   that can be brought to the theater: 100% if its capital is inside the theater
   or land-connected within `supplyRangeKm`; otherwise limited by sea lift
   (`troopLiftPerShip` x ships + merchant tonnage) and air lift, and those
   formations arrive over time at the nearest own port/coast cell or theater
   edge. A user `commitment` overrides this.
   As built: sea lift is `troopLiftPerShip` x ships only. Merchant tonnage and
   air lift are not used because the contract has no troops-per-ton or
   air-lift constants. Overseas formations arrive in waves, one lift per round
   trip (`naval.speedKmDay`), and arrivals stop under blockade.
7. **Formations.** Each member's committed P-role personnel and N-role platforms
   are split into formations of `org.formationSize` (by weapons tech), keeping
   the member's role mix. Formations start at own cities/places in the theater
   (weighted by population), else at the entry point, or at `startPositions`.
   Naval and air platforms are not map formations: they form a theater fleet and
   air force per side (sections 6, 7). Reserves and new recruits appear later
   (section 9).

## 3. Combat power

For a formation F of side S fighting side T, per role r:

```
OLI_r      = TLI_r(weaponsTech_S) / dispersion(weaponsTech_T)
```

Dispersion uses the TARGET's tech: a machine gun against a dense ancient
formation is far more lethal than against dispersed modern infantry. This is
the core of honest cross-era results.

```
P_F = sum_r count_r x OLI_r
      x armorMatrix[weaponsTech_S][armorTech_T]
      x terrainAttackFactor[terrain] (attacker only) x terrainMountedFactor (mounted/vehicle roles)
      x qualityFactor(quality_r) x trainingFactor(training_r) x commandFactor(commandQuality)
      x moraleFactor (= 0.5 + morale) x supplyFactor (ammo/fuel fraction for tech >= 6)
      x posture (defensePostureFactor for a prepared defender, fortificationFactor in a fortified city)
      x surpriseFactor (if surprise) x riverCrossingFactor (attacking across a river)
      x combinedArms (1 + combinedArmsBonus x doctrine.combinedArms x roleDiversity)
      x modern gaps: (1 + isrPerLevel x gapISR) (1 + ewPerLevel x gapComms) (1 + cyberPerLevel x gapCyber)
                      (1 + precisionStrikePerLevel x gapWeapons, only if weaponsTech >= 8)
      x air support (strike sorties allocated to this battle, OLI of aircraft_strike/helicopters/drones)
      x homeDefense (defender on its own starting territory)
```

`factor(rating)` for the 0..1 ratings interpolates the MV: rating 0 -> `low`,
0.5 -> `mid`, 1 -> `high`. Range (`rangeKm`) decides which side's roles fire in
the first hour: roles out-ranged by the enemy contribute 0 in the opening round
unless they close (melee roles close in round 2).

Tech index per quantity (as built): combat, breakpoint, formation size and
training days by `weapons`; supply needs, forage dependence, disease and
role mobility by `logistics`; order delay, mobilization and desertion by
`communications`; ships and aircraft by `ships` and `air`. `missiles` and
`air_defense` are ground roles inside formations. The supply factor scales the
power a formation fires with, not its size as a target (see section 4).

## 4. Tactical resolution

A battle happens when opposing formations share a cell or are adjacent and one
side's AI attacks (or both move into the same cell). All formations of each side
within the cell and its neighbours join (corps_system: also those within one
day's march).

Each battle day is split into H = `battleHoursPerDay` rounds. Per round:

```
R      = P_attacker / P_defender
lossD  = baseDailyCasualtyRate(tech_D) x R^alpha / H
lossA  = baseDailyCasualtyRate(tech_A) x R^-alpha / H     alpha = powerRatioExponent(tech)
```

As built, each side's loss uses the enemy's FIRING power over its own FULL
power: `lossD = base_D x (Pfire_A / Pfull_D)^alpha / H` and the mirror for the
attacker. Outside the opening round both are equal, so this is the formula
above exactly. In the opening round out-ranged roles do not fire but still
count as targets, and an out-of-supply side fires with less but is not a
smaller target; the plain R form gave R = infinity (a side that could not
reach the enemy took the 50% cap) and let a bronze-age force shred
unsupplied modern formations. Storming a fortified place multiplies the
attacker's loss rate by `siege.assaultFactor` (not attacker power).
The withdraw threshold is min(`retreatThreshold`, 0.9 x effective breakpoint)
with effective breakpoint = `breakpoint(tech)` + `cohesionBreakpointShift` x
(cohesion - 0.5), so withdrawal always comes before the rout. Morale falls by
the round's loss as a share of STARTING strength (l x (1 - engLoss)), the
basis engLoss accumulates on, so morale reaches 0 exactly at the breakpoint
(`MORALE_ON_ENGAGED_BASIS`). Pursuit losses are `pursuitLossFraction` x
max(winner mobile share, `footPursuitFloor`), and when a battle is decided
they fall on the beaten side's withdrawing formations as well as its routed
ones (`PURSUE_WITHDRAWING`), unless the withdrawing formation has the
horse-archer mobility edge. Measured: loss ratio passes 10 -> 13 of 24.
`footPursuitFloor` is a placeholder at 0 until sourced. The share of losses
caused by air support is booked as cause `air`.

Losses are capped at 50% of engaged strength per round, spread over roles in
proportion to their exposure. A seeded noise factor (lognormal, sigma 0.15 per
round) represents friction and chance. Morale falls with losses. A formation
whose cumulative battle loss reaches the doctrine `retreatThreshold` withdraws
in good order; one reaching `breakpoint(tech)` (shifted by cohesion) routs: it
suffers `pursuitLossFraction` x (winner mounted/mobile share) extra losses, of
which `captureFraction` are prisoners, and flees toward supply. When every
formation of one side has withdrawn or routed, the battle ends. Otherwise it
continues the next day.

Specials: `phalanx` (+ frontal, - flank when the enemy has flanking > 0.6),
`horse_archery` (out-ranges melee in round 1, retreats from melee at no cost
when mobility advantage), `feigned_retreat` (once per battle, a staged retreat
that draws the enemy into a pursuit; the pursuers lose cohesion and take one
round of losses at 2x if their doctrine initiative < 0.5), `field_fortification`
(defender posture factor every night in camp), `massed_artillery`,
`defense_in_depth` (+ posture, slower breakthrough), `human_wave` (+ power, +
own losses). Each special's multiplier is a mechanics constant.

## 5. Movement

Formation speed = `rate[roleMobility(slowest role, tech)]` x `terrain[class]`
(x `roadBonus` on cells with roads: own territory cells containing a place, or
for tech >= 3 any own cropland/urban cell) x `season` x `weather` x
(1 - `restDayFraction`) x air superiority factor if the enemy holds the air.
Paths are A* over the theater grid with cost = km / speed (days). As built:
flow fields instead of per-formation A* (one multi-source Dijkstra per side
per objective, at most 12 per side, recomputed each AI cycle); formations walk
downhill with a small stacking penalty so they spread over a front, and spread
to a less crowded neighbour when short of supply. A formation with vehicles
moves at its rate x fuel fraction, but never slower than foot pace (the troops
walk out when the fuel is gone; without this floor unsupplied armour froze in
place for good). Water cells
are impassable to land formations unless embarked (sea lift, section 6). Major
river cells cost an extra half day without a bridge (a city cell).

Invariant (tested): no formation ever moves more km in a day than its
`rate` x best multipliers.

## 6. Naval

Each side's ships form one theater fleet, propulsion by ships tech (oar <= 3,
sail 4-6, steam 7-8, modern 9-10). Daily, if both sides have fleets and the
weather permits (`weatherDenial`), fleets fight a Lanchester engagement using
ship OLI. Sea control = own fleet power / (own + enemy). Effects: sea supply
throughput x sea control; enemy sea control above 0.6 interdicts
(`blockadeInterdiction`) and blocks amphibious moves and reinforcement by sea;
blockade lowers production (`blockadeProductionFactor`) for members whose
territory is mostly reachable only by sea.

## 7. Air

Theater air war per side when air tech >= 7. Fighters contest the air:
sorties x OLI, attrition from `lossPerSortie` by (enemy air-defense tech minus
own air tech). Superiority: fighter-power ratio above `superiorityRatioThreshold`.
Strike aircraft, helicopters and drones fly `sortiesPerAircraftDay` within
`combatRadiusKm` of own bases, split between battle support (added to P),
interdiction (reduces enemy supply throughput) and, with `strategic_bombing`,
production. Missiles strike formations and air defence.
As built: strategic bombing of production is not implemented (the contract
has no bombing-damage constant); missiles fight as a ground role. Naval
battles reuse the ground casualty model at ships tech (no separate naval
attrition constant).

## 8. Logistics and attrition

Daily need per formation: food (`foodKgPerPersonDay` x personnel +
`fodderKgPerAnimalDay` x animals), and by tech `supplyTonsPer1000Day`, plus
`ammoTonsPer1000CombatDay` on battle days and `fuelTonsPerVehicleDay` for
vehicles that moved or fought.

Supply comes from two places:
- **Forage**: `forageYield[terrain]` x cell area x season (x
  `forageWinterFactor`) x remaining forage in the cell, times
  `forageDependence(logistics tech)`. Each pass depletes the cell
  (`forageDepletion`), so large pre-modern armies starve when they stay put.
  `scorched_earth` zeroes forage in cells a side abandons.
- **Supply network**: sources are own cities, capitals and ports inside the
  theater (and the entry point for overseas members). A Dijkstra cost field
  (days of travel) over own-controlled land cells, plus sea links weighted by
  sea control. A formation within `supplyRangeKm` along an uncut path receives
  delivery = need x clamp(1 - distance/range, 0, 1) x throughput limits x enemy
  air interdiction.
  As built: full delivery within `supplyRangeKm`, falling linearly to zero at
  2 x range. The 1 - d/range form starved armies fighting on their own
  territory, because `supplyRangeKm` is the distance an army can operate
  beyond its base. Distance is km of open country: cost per km = plains
  terrain factor / (terrain x road), so roads stretch the range and rough
  ground shortens it (raw km / speed cut every range by 40%). Besides cities
  and capitals, the urban cells of a member's own starting territory are
  depots (at most 200 per member). Each source delivers at most its
  throughput (`throughputRoadTonsDay`, rail, port), shared pro rata. Allied
  sources deliver x (1 - `coalitionFriction`). Forage regrows to full at the
  start of each summer.

Shortfall reduces the supply fraction, multiplies `diseaseDaily` by
`starvationMultiplier`, costs morale (`supplyShortfallPenalty`) and, for
modern forces, reduces ammo/fuel and hence combat power and movement.
Non-battle losses per day: `diseaseDaily(tech)` x (`winterExposure` in winter
outside towns, `desertHeat` in desert in summer) + `desertionDaily` when morale
<= 0.5. A fraction `returnToDuty` of non-battle losses returns after 30 days.
Reported casualties are combat + pursuit + captured + air + naval + nuclear;
disease, exposure, starvation and desertion are listed by cause but not
counted as casualties.

## 9. Production and mobilization

- Trained reserves arrive at the capital (or entry point) after
  `mobilizationDays(tech)`, faster with `levee_en_masse` (as built: the
  `low` end of `mobilizationDays` and the `high` end of
  `cohortTrainableFraction`).
- New recruits: `annualCohort` x `cohortTrainableFraction` per year, ready after
  `trainingDays`, capped by `mobilizable` minus everyone already called up.
- Platforms: `production[role]` per year, x `blockadeProductionFactor` under
  blockade, x strategic bombing damage, delivered monthly.

## 10. Command AI

Each side has one commander per member nation (coalition friction:
`coalitionFriction` per extra member slows its order cycle and lowers
coordination). Orders reach formations after `orderDelayDays(communications
tech)` (`mission_command` halves it). Each order cycle:

1. Estimate the enemy: with fog of war, enemy formations further than the
   side's scouting radius (doctrine `scouting` x cavalry/air/ISR) are seen
   with an error of +/-50% strength, or not at all.
2. Score objectives: enemy capital and cities (weighted by `siegePreference`),
   enemy formations (weighted by 1 - siegePreference and by local force ratio),
   own threatened cities (defence). Score uses doctrine weights:
   `aggression` raises attack scores, `logisticsDiscipline` penalises targets
   beyond supply range, `maneuver` prefers weak enemy formations and
   encirclement over frontal attacks, `flanking` offsets approach paths.
3. Assign formations greedily to the best objectives until each objective has
   the force ratio the doctrine wants (attrition doctrines mass, maneuver
   doctrines move fast with less); keep `reserveUse` x strength in reserve at
   the most threatened own city.
4. Formations below `retreatThreshold` or out of supply for more than a few days
   fall back toward the supply network to recover.
   As built: the cycle runs every 5 days. A formation falls back for supply only
   when it is out of supply AND beyond `supplyRangeKm` of a reachable depot
   (at a congested depot or when cut off, moving back feeds no one), and is
   available again once morale is back to 75% of its baseline. Fog of war is
   modelled as visibility around own formations, not a strength error.

## 11. Nuclear (off by default)

Only with `rules.nuclear` on and only for members with warheads. Escalation
model: a side uses nuclear weapons only when it has lost more than
`escalationThreshold` of its own starting theater territory, or its capital is
under siege. First use targets the largest enemy formation concentration;
retaliation, if the enemy has warheads, targets cities (`cityLoss`). Every strike
is an event with its trigger. The model is a deliberately simple escalation
ladder, not a prediction of nuclear decision-making.

## 12. Ending and explanation

Victory conditions per scenario: capital captured (an enemy formation holds the
capital cell uncontested for 1 day; a fortified capital must be besieged for
`daysToReduce` or stormed), territory share, army collapse (personnel below 10%
of start or side morale below 0.15), time limit (draw unless one side holds
clearly more of the other's territory and strength).
As built: the morale collapse needs side morale to have fallen below 0.15 (a
force that starts that low is not beaten on day 1). "Clearly more" is a 10
point territory margin plus at least equal remaining strength. A war with no
battle or change of territory for 120 days ends as at the time limit, unless
forces are still on their way. Backtest objectives: a capture objective (not
held at start) wins when taken; a hold objective is judged at the end, and the
side still holding it wins.

Explanation: the engine compares the sides on the accumulated factors and ranks
them: tech gap (mean power multiplier from TLI/dispersion/armor), numbers
(personnel and platform ratio), supply (shortfall days, starvation losses),
naval control, air superiority, morale collapses, command and doctrine, terrain
and fortification, disease/attrition. Each reason carries numbers.

## 13. Monte Carlo

N runs with seeds `seed + i`, without frames. Reports win probability per
side and draw, p10/p50/p90 for duration and casualties, and the reasons most
often ranked first.

## 14. Replay

The worker stores a full state keyframe every 30 days. Seeking to day d
restores the last keyframe <= d and re-simulates to d. Because the engine is
deterministic, the replay matches the original run exactly (tested: full state
and frame equal to an uninterrupted run, `tests/engine/worker.test.ts`).
