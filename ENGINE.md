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
      x posture: max(defensePostureFactor if prepared, fortificationFactor in a fortified place,
                     fieldFortification for field_fortification doctrines, not for a side the case
                     marks prepared:false)   (alternatives, not a product)
      x surpriseFactor (if surprise) x riverCrossingFactor (attacking across a river: in battle mode
        only when the case sets riverCrossing, not from the 25 km grid river flag)
      x combinedArms (1 + combinedArmsBonus x doctrine.combinedArms x roleDiversity)
      x modern gaps: (1 + isrPerLevel x gapISR) (1 + ewPerLevel x gapComms) (1 + cyberPerLevel x gapCyber)
                      (1 + precisionStrikePerLevel x gapWeapons, only if weaponsTech >= 8)
      x air support (strike sorties allocated to this battle, OLI of aircraft_strike/helicopters/drones)
      x homeDefense (defender on its own starting territory)
```

`factor(rating)` for the 0..1 ratings interpolates the MV: rating 0 -> `low`,
0.5 -> `mid`, 1 -> `high`. Range (`rangeKm`) decides which side's roles fire in
the first hour: roles out-ranged by the enemy contribute 0 in the opening round
unless they close (melee roles close in round 2). As built
(`RANGE_INTEGER_CLASS`), the comparison uses each role's range at the integer
tech level reached (floor), so a 0.05-level difference across a steep table
step (artillery 0.9 km at 6, 6 km at 7) no longer silences a whole army.

Tech index per quantity (as built): combat, formation size and
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
attacker's loss rate by `siege.assaultFactor` (not attacker power), and only
at real fortified places: a battle case's `fortified` field position gets the
fortification power factor but not the breach-storming factor
(`ASSAULT_ONLY_REAL_FORTS`). The defender's prepared defence, fortification
and field fortification are QJM alternatives, so the largest applies
(`DEFENSE_ALTERNATIVES_MAX`; their product reached 1.95, above QJM fortified
1.6). In battle mode a defender is prepared only when the case says so
(`BattleSide.prepared`, default false, `PREPARED_FROM_CASE`); in war mode a
defender that stood still for a day is prepared. Measured together: winner
12 -> 14, loss ratio 13 -> 16, duration 21 -> 22 of 24.
The withdraw threshold is min(`retreatThreshold`, 0.9 x effective breakpoint)
with effective breakpoint = breakpoint + `cohesionBreakpointShift` x
(cohesion - 0.5), so withdrawal always comes before the rout. The breakpoint
(`BREAKPOINT_FROM_MODEL_RULES`) is `modelRules.breakpoint.loserCasualtyShareAtBreak`
for the member's era (`napoleonic` for 1789-1849): the loser's casualty share
when it broke, from CDB90 with the 24 backtest battles removed (gunpowder to
cold war grade B, bronze, medieval and modern grade D). Each seed draws one
quantile u from its own stream and every member takes its era MV at u
(0 low, 0.5 mid, 1 high, piecewise linear); `SimOptions.breakpointQuantile`
fixes u, 0.5 being the deterministic mid (`scripts/backtest.ts --bp-quantile`).
OFF: the tech-keyed `morale.breakpoint` table. Measured (20 seeds, Run 3
20/14/22): per-seed draw 20/17/21; all at low 21/15/19, mid 20/17/20, high
21/16/23. Morale falls by
the round's loss as a share of STARTING strength (l x (1 - engLoss)), the
basis engLoss accumulates on, so morale reaches 0 exactly at the breakpoint
(`MORALE_ON_ENGAGED_BASIS`). Pursuit losses are max(mounted, foot) x
exploitation specials, where mounted = `pursuitLossFraction` x winner mobile
share (cavalry, vehicles, air) and, with `PURSUIT_FROM_MODEL_RULES`, foot =
`modelRules.battle.footPursuitLossFloor` (0.09, Krentz hoplite data) capped
at 1 - `pursuitDisengageShare`(loser era) - the loser's battle loss share, so
a foot-only winner never takes more than the share that historically failed
to get away; the mounted term is not capped. When a battle is decided they
fall on the beaten side's withdrawing formations as well as its routed ones
(`PURSUE_WITHDRAWING`), unless the withdrawing formation has the
horse-archer mobility edge. Measured: loss ratio passes 10 -> 13 of 24
(pursuit of withdrawing formations); the sourced foot term leaves the counts
at 20/15/22 and moves Agincourt x0.15 -> x0.26, Marathon x9 -> x17 (the
model's Persian winners now pursue). The share of losses caused by air
support is booked as cause `air`.

Losses are capped at 50% of engaged strength per round, spread over roles in
proportion to their exposure. A seeded noise factor (lognormal per round,
sigma `modelRules.battle.outcomeNoiseSigma` 0.25 from Helmbold's residuals,
0.15 before; `RULES_FROM_MODEL_RULES`) represents friction and chance. Morale falls with losses. A formation
whose cumulative battle loss reaches the doctrine `retreatThreshold` withdraws
in good order; one reaching the breakpoint (shifted by cohesion) routs: it
suffers `pursuitLossFraction` x (winner mounted/mobile share) extra losses, of
which `captureFraction` are prisoners, and flees toward supply. When every
formation of one side has withdrawn or routed, the battle ends. Otherwise it
continues the next day. In war mode a beaten formation standing in the battle
cell gives it up: it falls back one cell toward its supply (lowest supply
distance among neighbours not held or occupied by the enemy), or, when no such
neighbour exists, surrenders (`BEATEN_LEAVE_CELL`): with
`SURRENDER_SHARE_FROM_MODEL_RULES` the era's `encircledSurrenderShare` is
booked as captured and the rest as killed (before: all captured).
Without this a beaten defender on a supply source never moved and the
objective could not be entered. Measured: winner 14 -> 18 of 24, loss ratio
16 -> 14 (Gulf War and Six-Day losers now lose more than history records).

Specials: `phalanx` (+ frontal, - flank when the enemy has flanking > 0.6),
`horse_archery` (out-ranges melee in round 1, retreats from melee at no cost
when mobility advantage), `feigned_retreat` (once per battle, a staged retreat
that draws the enemy into a pursuit; the pursuers lose cohesion and take one
round of losses at 2x if their doctrine initiative < 0.5), `field_fortification`
(defender posture factor every night in camp), `massed_artillery`,
`defense_in_depth` (+ posture, slower breakthrough), `human_wave` (+ power, +
own losses). Each special's multiplier is a mechanics constant.

Battle mode details (as built): when both sides break in the same round, the
side further past its breakpoint (strength-weighted engLoss / breakpoint)
loses instead of a draw (`SIMULTANEOUS_BREAK_BY_SEVERITY`). A reinforcement
due at a fractional day joins that day's battle at round ceil(fraction x H)
and is neither firing nor hit before then (`SUBDAY_REINFORCEMENTS`).
Measured with the range and river rules: winner 18 -> 20, loss ratio 14 -> 15
of 24.

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
are impassable to land formations unless embarked (sea lift, section 6). As
built (`SEA_MOVEMENT`): a side that is not blockaded and has ships in the
theater can move land formations across sea cells at `movement.rate.sea`,
with at most `troopLiftPerShip` x theater ships personnel at sea at once,
embarking from any coastal cell. With `SEA_LIFT_TONNAGE` the limit is in
shipping tonnage: capacity = that troop lift x `seaLiftGrtPerSoldier` (ship
era), and a formation needs personnel x `seaLiftGrtPerSoldier` (its era) plus
its tracked and wheeled vehicles (`seaLiftTonsPerVehicle`, measurement tons x
0.4 = GRT, no broken stowage). The per-soldier figure is a long-haul average
that already carries a division's share of vehicles, so armoured formations
count somewhat high. Measured: backtests identical; seed 1 presets: Allies vs
Axis without the two largest goes from an Axis win on day 329 to a draw at
730, USA vs China still a Chinese win (day 503 vs 493). No airlift: the
engine has no transport-aircraft role, so `airLiftTonsPerDayPerAircraft` is
not read. Land first: an objective's flow field opens
sea cells only when some own formation cannot reach it overland, or only by a
march longer than its supply range (a member without a researched range only
when cut off). Named simplification: no ports or embarkation time; those
need sourced constants. Formations on sea cells are never fought with the
land combat model (`EMBARKED_NAVAL_ONLY`): no battle forms on a sea cell, and
while the enemy has a fleet in the theater they lose
`modelRules.naval.navalAttritionPerDay` of the formation's era per day at sea
(cause naval; 0.001 in the world wars). A landing from the sea onto an
enemy-held shore cell is a land battle on that cell. Before, allies-vs-axis
had 15 land battles on sea cells and usa-vs-china 173 (QA round 2); a first
version that sank troops with their fleet's daily fleet-action loss drowned
555k Allied troops in 90 days and was replaced. Seed 1 now: allies-vs-axis
naval losses 17k/6k, Axis win day 144 (133 before); usa-vs-china a draw at
730 (Chinese win day 515 before). Backtests identical per case. Formations
at sea draw no supply and
show as Embarked. Major
river cells cost extra days without a bridge (a city cell):
`riverCrossingDelayDays` of the member's era (3 before 1500, 0.5 in the world
wars, 0.25 modern; a flat half day before `RULES_FROM_MODEL_RULES`).

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
As built (`HOSPITAL_ADMISSIONS_RETURN`): these rates are admissions. The
`returnToDuty` share leaves the formation for hospital and comes back after 30
days; it is not a loss and its return is not an arrival. Only the rest
(deaths, discharges) and all desertion are booked as losses. Booking every
admission as a loss had Germany "lose" 805k to disease in 106 days of the 1940
preset (264k in 133 days after the change, at the data's `diseaseDaily`).
With `ATTRITION_FROM_MODEL_RULES` the lost share and the hospital stay come
from the member's era: `modelRules.attrition.diseaseDeathShareOfAdmissions`
(WWII 0.03, napoleonic 0.15, classical 0.15) and `returnToDutyDays` (WWII 15,
napoleonic 40, before 1789 30), instead of 0.3 and 30 days everywhere.
Measured: counts unchanged at 20/15/22; Gulf War loss ratio x9.3 -> x4.9,
Iraq 2003 x1.21 -> x1.00, France 1940 x6.8 -> x6.2.
In battle mode a battle decided on its first day (shorter than a day) books no
non-battle losses at all (`BATTLE_NO_DAILY_ATTRITION`): the rates are per day
of campaigning, not per hour of fighting.
Reported casualties are the sum of losses over every cause
(`CASUALTIES_ALL_CAUSES`), so they equal the lossesByCause total; tested:
start + arrivals = current + losses + in hospital, every day.

## 9. Production and mobilization

- Trained reserves arrive at the capital (or entry point) after
  `mobilizationDays(tech)`, faster with `levee_en_masse` (as built: the
  `low` end of `mobilizationDays` and the `high` end of
  `cohortTrainableFraction`).
- New recruits: `annualCohort` x `cohortTrainableFraction` per year, ready after
  `trainingDays`, capped by `mobilizable` minus everyone already called up.
- Platforms: `production[role]` per year, x `blockadeProductionFactor` under
  blockade, x strategic bombing damage, delivered monthly.
- Formations need personnel (`CREWED_FORMATIONS`). Delivered land platforms
  with no personnel in the depot join the member's crewed formation nearest
  its spawn cell instead of forming a formation of their own (crews of tanks,
  guns and aircraft are support personnel, not P roles, so a platform-only
  formation had no one to lose). A formation whose personnel falls below half
  a man is destroyed and its platforms are booked as platform losses; a side
  with no personnel in a battle cannot win it, and a crewless formation never
  claims a cell. Before, japan-vs-usa-1941 crewless US formations won 18
  battles and inflicted 849k of 1.09M battle casualties (QA round 2); seed 1
  now ends as a draw at the time limit. Backtests identical per case.

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
   the most threatened own city. As built (`RESERVE_NO_OVERSHOOT`): the reserve
   skips formations that would overshoot that share and is empty when a member
   has a single available formation (the first formation was always taken).
   A Defend objective's need is its nearby enemy power, capped
   (`AI_DEFEND_CAP_BY_VALUE`) at the member's army x that objective's
   doctrine-weighted value / the summed value of the chosen objectives, and
   the cap is a ceiling: formations that would overshoot it are skipped.
   Before, Defend slots near the start won on distance and their need took
   the whole army (89 of 92 German formations defending France 1940).
   Strengths are compared in battle units (`AI_CROSS_ERA_POWER`): enemy
   strength x enemy dispersion / own dispersion, so a 2026 army no longer
   reads a Roman legion's TLI as if both hit the same target. Formations left
   after the objectives are covered join the nearest attack when the commander
   is aggressive (aggression >= 0.5) or its side is the stronger one
   (`AI_STRONGER_SIDE_ADVANCES`).
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

Control (daily, after logistics): a cell occupied by one side only goes to
that side; an empty cell next to formations of one side only goes to it; a
cell whose holder has no supply path to it passes to the enemy from an
adjacent enemy cell. With `ENCIRCLED_FLIP_NEEDS_SUPPLY` that adjacent cell
must be supplied by the enemy: without it, where neither side had supply the
two flipped each other's cells every day and the front became a checkerboard
(the striped control overlay; Rome 117 vs Spain 2026 on the engine before
fix round 1, seed 1, 76 isolated cells at day 119, 16 with the rule).

Victory conditions per scenario: capital captured (an enemy formation holds the
capital cell uncontested for 1 day; a fortified capital must be besieged for
`daysToReduce` or stormed), territory share, army collapse (personnel below
`armyCollapsePersonnelFraction` 0.5 of all fielded, re-derived from ten wars
outside the backtest set, grade C), or side morale collapse, time limit (draw unless
one side holds clearly more of the other's territory and strength).
Morale collapse: side morale below min(`armyCollapseMorale`, start morale -
`morale.defeatShock`) (`COLLAPSE_NEEDS_REAL_FALL`): the army must have
fallen at least one lost battle's morale shock below where it began, so a
side that starts near the threshold (Iraq 1991 at 0.20) does not collapse on
a trivial dip. When an army collapses (personnel or morale), the era's
`encircledSurrenderShare` of every formation it still has on the map is
booked as captured (`COLLAPSE_SURRENDER`), the same share a destroyed pocket
surrenders. `armyCollapseMorale` = 0.15 is an UNSOURCED MODEL-DEFINITION
CONSTANT (the engine's original definition; no source measures this
engine-internal scale). Backtest at its range (`scripts/backtest.ts --sweep
modelRules.collapse.armyCollapseMorale 0.10,0.15,0.20,0.25`): 19/16/24,
19/16/24, 20/15/24, 20/15/24. The Six-Day War winner flips across the range
(fails at 0.10-0.15, passes at 0.20-0.25), so it counts as unresolved; the
Falklands loss ratio likewise (passes only at 0.10-0.15). "Clearly more" is a 10
point territory margin plus at least equal remaining strength. A war with no
battle or change of territory for 120 days ends as at the time limit, unless
forces are still on their way. Backtest objectives: a capture objective (not
held at start) wins when taken; a hold objective is judged at the end, and the
side still holding it wins. With `OBJECTIVE_KIND_EXPLICIT` a case can name the
kind (`objective.kind` 'capture' | 'hold' | 'destroy'). A named capture
objective counts only once an own formation stands on it with no enemy there,
and only if the enemy held the cell at the start; setup warns when it does
not (it then cannot be won by capture). A destroy objective (`radiusKm`
required) is won when every enemy formation standing within the radius at
the start is destroyed or has surrendered, wherever it has gone since: an
encircled army such as Stalingrad's 6th Army. Unnamed kinds keep the
inferred rule. Measured: 19/15/22 -> 20/15/24 (Stalingrad ends on day 36-38
by Axis army collapse instead of day 1; Yom Kippur 0% -> 70%, Israel takes
Deversoir; Egypt's Mitla Pass objective starts in Egyptian control in the
case's nearest-start split, so it warns).

Backtest case construction, ON by correctness (round 1 left them OFF for
costing a pass, which was selection by outcome): `CASE_SUPPLY_RANGE_FROM_SNAPSHOT`
(synthesized sides borrow `supplyRangeKm` from the snapshot nearest in
logistics tech, then year; without it the AI distance scale is 1 km),
`CASE_SUPPLY_RULE_ON` (campaign backtests run with the supply rule) and
`CASE_CAPITAL_UNFORTIFIED` (a case side's main start position is not a
fortress). Measured together: 19/16/24 -> 19/15/23. Stalingrad now ends on
day 6 by Axis morale collapse (out-of-supply pocket; ratio x0.18 and duration
fail), Gulf War and France 1940 end by taking Kuwait City and Paris, Iraq
2003 takes 25 days (ratio x0.50), Yom Kippur 70% -> 100%.
The backtest reads `public/data`; `tests/buildFresh.test.ts` rebuilds
`battles.json` and `mechanics.json` from `data/` in memory and fails when the
shipped copies differ, so a data edit without a rebuild cannot silently change
the backtest.

Explanation: the engine compares the sides on the accumulated factors and ranks
them: tech gap (mean power multiplier from TLI/dispersion/armor), numbers
(engaged personnel ratio per battle with `EXPLAIN_LOCAL_POWER`, else role
counts, which add platforms to people), supply (shortfall days, starvation losses),
naval control, air superiority, morale collapses, command and doctrine, terrain
and fortification, disease/attrition. Each reason carries numbers. Per-battle
ratios are means of log(side 0 / side 1) weighted by the battle's size. The
Numbers text also reports the opening-round combat-power ratio (all factors
combined), so a side that outnumbers locally but is out-gunned reads as such
(Mongols 1241 vs France 1805: x293 personnel, x2.2 power).

## 13. Monte Carlo

N runs with seeds `seed + i`, without frames. Reports win probability per
side and draw, p10/p50/p90 for duration and casualties, and the reasons most
often ranked first.

## 14. Replay

The worker stores a full state keyframe every 30 days. Seeking to day d
restores the last keyframe <= d and re-simulates to d. Because the engine is
deterministic, the replay matches the original run exactly (tested: full state
and frame equal to an uninterrupted run, `tests/engine/worker.test.ts`).
