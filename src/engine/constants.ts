// Model-plumbing constants. None of these is a real-world quantity: they set
// grid resolution, planning cadence, bookkeeping and output throttling.
// Real-world constants live in the Mechanics object (public/data/mechanics.json).

/** Theater cells above this are merged k x k (ENGINE.md 2.4). */
export const MAX_THEATER_CELLS = 20000;
/** Replay keyframe interval in days at the start of a run (ENGINE.md 14). */
export const KEYFRAME_DAYS = 30;
/** Most replay keyframes the worker holds. When the store fills, every other keyframe is
 *  dropped and the interval doubles, so memory is bounded on any run length and a seek
 *  re-simulates at most one interval. Measured on germany-vs-france-1940 run to the UI's
 *  36,500-day limit with every victory condition off (red team W9; v8.serialize bytes):
 *  unbounded 1,217 keyframes, 7,673 MB (8.5 MB each by the end); capped 39 keyframes,
 *  246 MB, interval 960 days, so a worst-case seek replays 960 days (about 11 s at the
 *  90 days/s that run stepped). Runs shorter than 1,920 days never thin, so every preset
 *  keeps its 30-day keyframes. */
export const MAX_KEYFRAMES = 64;
/** Base command re-plan interval in days, before coalition friction. */
export const AI_CYCLE_DAYS = 5;
/** Candidate objectives (each gets a flow field) per side and cycle. */
export const AI_MAX_OBJECTIVES = 12;
/** Enemy formations are clustered on a coarse grid of about this many sectors per axis. */
export const AI_SECTORS_PER_AXIS = 12;
/** Desired local force ratio the AI masses before attacking: attrition doctrine (maneuver 0)
 *  vs maneuver doctrine (maneuver 1). Used only with AI_RATIOS_FROM_MODEL_RULES OFF. */
export const AI_MASS_RATIO_ATTRITION = 3;
export const AI_MASS_RATIO_MANEUVER = 1.5;
/** AI objective values (relative weights for ranking objectives). */
export const AI_VALUE_CAPITAL = 3;
export const AI_VALUE_CITY = 1;
export const AI_VALUE_FORMATION = 1.5;
export const AI_VALUE_DEFENSE = 2;
/** A formation that has lost this share of its battle-loss allowance resumes duty after recovery. */
export const AI_RECOVERED_STRENGTH = 0.75;
/** Cap on formations per member; larger forces get proportionally larger formations. */
export const MAX_FORMATIONS_PER_MEMBER = 6000;
/** Urban land-cover cells per member used as extra supply depots (bounds per-day cost). */
export const MAX_URBAN_SOURCES_PER_MEMBER = 200;
/** Supply delivery is full within supplyRangeKm and falls linearly to zero at this multiple of it. */
export const SUPPLY_FALLOFF_MULT = 2;
/** Route choice: each own formation already in a candidate cell adds this many cell-widths
 *  of cost, so columns fan out into a front instead of stacking on one path. */
export const STACK_PENALTY_CELLS = 0.5;
/** Days a routed formation flees before it may rally (if not yet at a supply source). */
export const ROUT_FLEE_DAYS = 3;
/** Days out of supply before the AI pulls a formation back. */
export const OUT_OF_SUPPLY_FALLBACK_DAYS = 3;
/** Recruits are inducted in monthly batches. */
export const RECRUIT_BATCH_DAYS = 30;
/** Global-grid land component smaller than this many 0.25 deg cells counts as an island
 *  (production exposed to blockade). Britain ~600 cells, Japan ~900, Australia ~12,000. */
export const ISLAND_CELL_LIMIT = 2000;
/** Share of strike sorties flown in battle support; the rest is interdiction. */
export const AIR_BATTLE_SHARE = 0.6;
/** Time-limit decision: a side wins on time only if it holds this much more of the
 *  enemy's starting territory than the enemy holds of its own and is not weaker. */
export const TIME_LIMIT_TERRITORY_MARGIN = 0.1;
/** Minimum days between nuclear strikes by the same side. */
export const NUCLEAR_COOLDOWN_DAYS = 7;
/** Losses per battle round are capped at this fraction of engaged strength (ENGINE.md 4). */
export const BATTLE_ROUND_LOSS_CAP = 0.5;
/** Fog of war: enemies beyond scouting radius x this are not seen at all. */
export const UNSEEN_RANGE_FACTOR = 2;
/** Frame/output throttling. */
export const CONTROL_FRAME_DAYS = 5;
export const MAX_SUPPLY_LINES = 40;
export const MAX_BATTLE_EVENTS_PER_DAY = 3;
export const MAX_FRAMES_PER_SECOND = 30;
/** Battle mode (backtests) ends as a draw after this many days without contact. */
export const BATTLE_MODE_NO_CONTACT_DAYS = 3;
/** War ends as a draw if no battle and no control change happened for this long. */
export const STALEMATE_DAYS = 120;

// Behaviour toggles (ENGINE.md 4). Each is a model change measured on the 20-seed backtest
// (VALIDATION.md); ON unless the measurement was negative.
/** Morale falls by the fraction of STARTING strength lost (l x (1 - engLoss)), the same basis as
 *  engLoss, so morale reaches 0 exactly at the breakpoint. Additive l made modern sides rout via
 *  morale at engLoss 0.26 before their 0.27 withdraw threshold (QA B1). */
export const MORALE_ON_ENGAGED_BASIS = true;
/** When a battle is decided, the beaten side's withdrawing formations take pursuit too, unless
 *  they have the horse-archer mobility edge. Without it every pre-gunpowder loser withdrew intact
 *  (0 routs in 77-209 losing formations per case) and lost 10-20% of its historical losses. */
export const PURSUE_WITHDRAWING = true;
/** Pursuit from the sourced model rules: a foot-only winner inflicts battle.footPursuitLossFloor
 *  (Krentz hoplite data, 0.09), capped so that battle.pursuitDisengageShare (per era) of the
 *  loser's start strength gets away; the mounted/air term pursuitLossFraction x mobile share is
 *  not capped. OFF: mounted term only (the old placeholder floor was 0). Measured: counts unchanged
 *  (20/15/22); Agincourt loss ratio x0.15 -> x0.26, Marathon x9 -> x17 (model's Persians win). */
export const PURSUIT_FROM_MODEL_RULES = true;
/** Defender posture takes the MAX of the alternatives QJM gives (prepared defence, hasty field
 *  fortification, fortified place) instead of their product: 1.5 x 1.3 = 1.95 exceeded QJM's own
 *  fortified 1.6 for every defender of a field_fortification doctrine (QA B3). */
export const DEFENSE_ALTERNATIVES_MAX = true;
/** siege.assaultFactor (sourced on storming the breach at Badajoz) multiplies the attacker's loss
 *  rate only at real fortified places, not at a battle case's field position (minefields at
 *  El Alamein and Kursk got x3 attacker losses). Field positions keep the fortification power factor. */
export const ASSAULT_ONLY_REAL_FORTS = true;
/** In battle mode a defender counts as a prepared defence only when the case says so
 *  (BattleSide.prepared); before, every battle-mode defender was 'prepared' because it spawned still. */
export const PREPARED_FROM_CASE = true;
/** A side the case marks prepared:false gets no field_fortification posture (QA B3 residual: the
 *  doctrine special gave x1.3 to Blenheim's French, Breitenfeld's Imperials, Tannenberg's Russians,
 *  Crassus's column at Carrhae and the 1940 Allies, all marked unprepared). Measured (20 seeds):
 *  19/14/23 -> 20/15/22. Blenheim winner 30% -> 90%, ratio x4.00 -> x1.12 (both pass); Tannenberg
 *  1.7 -> 1.5 days fails duration (hist 5); Carrhae 0% -> 15%; France 1940 95% -> 90%, x4.08 -> x4.63. */
export const FIELD_FORT_NEEDS_CASE_PREP = true;
/** Battle mode: no daily disease, exposure, starvation or desertion inside a battle decided on its
 *  first day (shorter than a day). The rates are per day of campaigning; a fight of hours booked a
 *  full day of them. Measured (20 seeds): 20/15/22 -> 20/14/22. 11 battle cases lose 0.3-11% of their
 *  median losses (Marathon Persians 945 -> 849); Waterloo ratio x2.98 -> x3.08 now fails. */
export const BATTLE_NO_DAILY_ATTRITION = true;
/** War mode: a beaten formation in the battle cell gives the cell up, falling back one cell toward
 *  its supply, or surrenders (all booked as captured) when every neighbour is enemy-held or
 *  impassable. Before, a beaten defender sitting on a supply source never left (its retreat field
 *  is 0 there), so an objective could be won in battle 31 times and never entered (QA C2). */
export const BEATEN_LEAVE_CELL = true;
/** A surrounded beaten formation is destroyed: modelRules.surrender.encircledSurrenderShare of it
 *  (per era: WWII 0.8 from Stalingrad, Kiev, Falaise, Tunisia; classical 0.3) is booked as
 *  captured, the rest as killed. OFF: all captured. Only the cause split changes (the formation is
 *  gone either way); backtest counts unchanged. */
export const SURRENDER_SHARE_FROM_MODEL_RULES = true;
/** AI reserve: skip formations that would overshoot reserveUse x strength, and never hold back a
 *  member's only available formation (the first formation was always taken, QA C3). */
export const RESERVE_NO_OVERSHOOT = true;
/** Opening-round range uses each role's range at the integer tech level reached (floor), not the
 *  interpolated value: interpolation across steep steps made 0.05 tech levels decide whether a whole
 *  army fired in round 0 (Waterloo French 1.16 km vs Coalition 1.41 km artillery; QA B4). */
export const RANGE_INTEGER_CLASS = true;
/** Battle mode: the attacker pays riverCrossingFactor only when the case says it crossed a river
 *  (BattleCase.riverCrossing), not whenever a major river runs somewhere in the 25 km cell (QA B5). */
export const RIVER_FROM_CASE = true;
/** Both sides breaking in the same round: the side further past its breakpoint loses, instead of
 *  a draw (Agincourt 10.6% vs 11.1% scored draws in half the seeds; QA B6). */
export const SIMULTANEOUS_BREAK_BY_SEVERITY = true;
/** Backtest reinforcements with a fractional day join that day's battle at round
 *  ceil(fraction x battleHoursPerDay), not from round 0 (Waterloo Prussians at day 0.21). */
export const SUBDAY_REINFORCEMENTS = true;
/** Backtest sides synthesized from a case (no snapshotId) borrow supplyRangeKm from the snapshot
 *  nearest in logistics tech, then year. Before, it was 0 (clamped to 1 km), which made the AI score
 *  every objective by 1/km so the synthesized base outranked the case objective (QA C4).
 *  ON by correctness (DECISIONS.md, validation discipline): it was left OFF in round 1 for costing a
 *  pass, which was selection by outcome. The three case toggles together: 19/16/24 -> 19/15/23. */
export const CASE_SUPPLY_RANGE_FROM_SNAPSHOT = true;
/** With a borrowed supply range, campaign backtests run with the supply rule on (it was off in all
 *  24 cases, so the logistics layer was never validated). ON by correctness, see above. */
export const CASE_SUPPLY_RULE_ON = true;
/** A case's synthesized 'capital' (its main start position) is an ordinary place, not a fortress:
 *  a fortified one added a siege (daysToReduce) where the objective sat on it (QA C5). ON by
 *  correctness, see above. With all three: Stalingrad ends on day 6 by Axis morale collapse (ratio
 *  x0.18, both fail), Gulf War and France 1940 end by taking their objectives, Yom Kippur 70 -> 100%. */
export const CASE_CAPITAL_UNFORTIFIED = true;
/** Objective kind from the case (objective.kind 'capture' | 'hold' | 'destroy') instead of inferring
 *  it from the nearest-start control split (QA C6). A capture objective is taken when an own
 *  formation stands on it with no enemy there, and only if the enemy held it at the start (QA
 *  round 2: Stalingrad and Yom Kippur were "taken" on day 1-3 with no battle). A destroy objective
 *  is won when every enemy formation within radiusKm at the start is gone. Cases without kind keep
 *  the inferred rule. Measured with the start-control rule: 19/15/22 -> 20/15/24. */
export const OBJECTIVE_KIND_EXPLICIT = true;
/** Hospital admissions from the sourced model rules (per era of the member): deaths and
 *  discharges = attrition.diseaseDeathShareOfAdmissions (WWII 0.03, napoleonic 0.15), the rest
 *  return after attrition.returnToDutyDays (WWII 15, napoleonic 40). OFF: loss share
 *  1 - attrition.returnToDuty (0.3 in every era) and RETURN_TO_DUTY_DAYS. Measured: counts unchanged
 *  (20/15/22); Gulf War loss ratio x9.3 -> x4.9, Iraq 2003 x1.21 -> x1.00, France 1940 x6.8 -> x6.2. */
export const ATTRITION_FROM_MODEL_RULES = true;
/** Non-battle attrition: diseaseDaily etc. are admission rates. The returnToDuty share goes to
 *  hospital (out of the formation, not a loss) and comes back after RETURN_TO_DUTY_DAYS; only the
 *  rest is booked as a loss. Before, every admission was booked as a loss and the returns came back
 *  as 'arrivals': Germany 'lost' 805k to disease in 106 days of germany-vs-france-1940. */
export const HOSPITAL_ADMISSIONS_RETURN = true;
/** SideStats.casualties = the sum of lossesByCause (every permanent loss), so the two agree. */
export const CASUALTIES_ALL_CAUSES = true;
/** Land formations cross sea cells inside the theater at movement.rate.sea while their side is not
 *  blockaded, up to the side's lift (troopLiftPerShip x theater ships) at sea at once. Embarking
 *  from any coastal cell, no port needed -- per-port embarkation and merchant-tonnage lift are the
 *  upgrade path once mechanics source troops per merchant ton. Land first: a flow field opens sea
 *  cells only when some own formation cannot reach the objective overland, or only by a march
 *  longer than its supply range (opening them always shipped the British around East Falkland:
 *  8 days vs 25 historical, a duration fail; land-only left US troops landed at Oslo marching
 *  through Sweden toward Russia). Before,
 *  armies on different land masses never met (usa-vs-china-2026, athens-vs-usa-2026,
 *  usa-spain-vs-russia-2026). */
export const SEA_MOVEMENT = true;
/** Sea lift in shipping tonnage: capacity = troopLiftPerShip x ships x seaLiftGrtPerSoldier (ship
 *  era); a formation needs personnel x seaLiftGrtPerSoldier (its era) plus its tracked/wheeled
 *  vehicles (seaLiftTonsPerVehicle, measurement tons x 0.4 = GRT). OFF: troops only, vehicles ride
 *  free. The per-soldier figure is a long-haul average that already carries a division's share of
 *  vehicles, so vehicle-heavy formations are counted somewhat high. Measured: backtests identical;
 *  seed 1 allies-vs-axis-minus-two Axis win day 329 -> draw day 730, usa-vs-china-2026 day 493 -> 503. */
export const SEA_LIFT_TONNAGE = true;
/** AI compares forces in the units battle uses: enemy strength (sum count x enemy TLI) is scaled by
 *  enemy dispersion / own dispersion, so both sides are lethality against the other's dispersion.
 *  Raw strengths compared a 2026 army's TLI with a Roman one's as if the target were the same. */
export const AI_CROSS_ERA_POWER = true;
/** Formations left over after the objectives are covered join the nearest attack when the
 *  commander is aggressive (aggression >= 0.5) OR its side is the stronger one in those units:
 *  the stronger side advances (Spain 2026, aggression 0.45, held most of its army against Rome 117). */
export const AI_STRONGER_SIDE_ADVANCES = true;
/** The explanation's Numbers factor compares engaged PERSONNEL per battle, and its text also
 *  reports the combat-power ratio at the opening round (all factors: tech, posture, command,
 *  air, morale). It used role counts, which add platforms to people (a tank and its crew counted
 *  4 + 1), and called that "strength". Measured seed 1: mongols-1241-vs-france-1805 personnel
 *  x293 but power x2.2; germany-vs-france-1940 personnel x0.69, power x2.0 for Germany.
 *  Presentation only: no backtest effect. */
export const EXPLAIN_LOCAL_POWER = true;
/** A cut-off cell (no supply path for its holder) passes to the enemy only from an adjacent
 *  enemy cell that the enemy itself supplies. Without it, where neither side had supply both
 *  flipped each other's cells every day and a front oscillated into a checkerboard: the striped
 *  control overlay (rome-117-vs-spain-2026 before fix round 1, seed 1 day 119: 76 isolated
 *  cells, rows of alternating R/s across northern Spain). */
export const ENCIRCLED_FLIP_NEEDS_SUPPLY = true;
/** Formations need personnel. Produced land platforms join the member's crewed formation nearest its
 *  spawn cell instead of forming a crewless formation; a formation whose personnel falls below half a
 *  man is destroyed and its remaining platforms are booked as platform losses; a side with no
 *  personnel in a battle cannot win it, and a crewless formation never takes control of a cell.
 *  QA round 2: in japan-vs-usa-1941 crewless US formations (e.g. 4 artillery + 1 armor, personnel 0)
 *  took no casualties, never broke, won 18 battles and inflicted 849k of 1.09M battle casualties. */
export const CREWED_FORMATIONS = true;
/** Formations embarked on sea cells are never fought with the land combat model: they meet the
 *  enemy only through naval interception, modelRules.naval.navalAttritionPerDay (0.001 per sea-day
 *  in the world wars, submarine-war losses) while the enemy has a fleet in the theater (cause naval).
 *  A first version sank them with their fleet's daily fleet-action loss and drowned 555k Allied
 *  troops in 90 days of allies-vs-axis-minus-two: the daily fleet action is a pool model, not a
 *  per-voyage exposure. QA round 2: allies-vs-axis-minus-two had 15 land battles on sea cells (65k
 *  casualties), usa-vs-china-2026 173 (33k). */
export const EMBARKED_NAVAL_ONLY = true;

// Pre-release engine fixes: combat and movement (VALIDATION.md section of that name).
/** Interdiction is flown by the side that HOLDS the air (or whose enemy has no fighters).
 *  OFF: the old test, which gave it to the side whose ENEMY held the air, so the supply cut
 *  (logistics: enemy holds the air AND interdicts) never fired in a real air war: Germany 1940
 *  held the air 90 of 90 days and flew no interdiction, France flew it every day. Measured (20
 *  seeds): 19/15/22 unchanged; only France 1940 moves, 80% -> 95%, x3.68 -> x3.21, 48 -> 53 days.
 *  Presets (10-seed screen, 11 air presets): Allies vs Axis 0/2/8 -> 0/0/10, NATO 1989 9/1/0 ->
 *  10/0/0, Argentina vs UK 2/6/2 -> 2/7/1, the other 8 unchanged. KEPT-ON-NULL: correctness fix
 *  the counts cannot see. */
export const AIR_INTERDICTION_BY_HOLDER = true;
/** Sea lift is checked at the step that embarks (land to sea), against what is already afloat.
 *  OFF: only when the sea cell was first chosen, so a formation that chose it on an earlier day,
 *  or before others embarked the same day, boarded whatever was afloat (han-vs-xiongnu day 8: lift
 *  114,000, afloat 161,070). Oracle (23 presets, seed 1, 200 days, side-days on which a formation
 *  boarded past the lift): 10 in 6 presets, worst x1.60 -> 0. Afloat load can still exceed lift
 *  after ships are lost at sea; those already embarked stay. Measured (20 seeds): 19/15/22,
 *  backtest byte-identical (no case goes to sea). Presets (10-seed screen, 23 presets):
 *  rome-vs-france-equalized 8/2/0 -> 9/1/0, Persia vs Greeks median day 322 -> 303, Han vs
 *  Xiongnu 85 -> 90, the rest unchanged in winners. KEPT-ON-NULL: correctness fix. */
export const SEA_LIFT_CHECKED_ON_ENTRY = true;
/** Army morale collapse needs a real fall: side morale below min(armyCollapseMorale, start morale
 *  minus morale.defeatShock), i.e. at least one lost battle's morale shock below where the side
 *  began. Before, a side only had to dip below its start, so Iraq 1991 (start 0.20, threshold 0.20)
 *  "collapsed" after one contact (QA round 2). defeatShock is the contract's own unit of a defeat
 *  on this scale; no new number. Measured with armyCollapseMorale back at 0.15 (one commit):
 *  20/15/24 -> 19/16/24; Six-Day War winner 95% -> 0% (now unresolved: it flips across the
 *  0.10-0.25 range), Falklands loss ratio x3.86 -> x0.86 passes, Gulf War Iraq collapses on day 9
 *  instead of 5. */
export const COLLAPSE_NEEDS_REAL_FALL = true;
/** A Defend objective takes at most its value's share of a member's army: min(enemy power near it,
 *  army x its doctrine-weighted value / the summed value of the chosen objectives). QA C4: Defend
 *  slots near the start won on distance and their need (all enemy power nearby) absorbed the army,
 *  so 89 of 92 German formations defended France 1940 on days 20-40. Measured (seed 1 trace):
 *  Germany d20/30/40 Defend/Attack 89/3 -> 21/71, 16/76, 9/39; Six-Day Israel 2/1 -> 1/2.
 *  20 seeds: counts unchanged 19/15/23; France 1940 winner 100% -> 95%. Iraq 2003 unchanged: its
 *  attacks are leftovers (archetype-modern-regional aggression 0.5 meets the >= 0.5 rule). */
export const AI_DEFEND_CAP_BY_VALUE = true;

/** Thresholds from the sourced model rules (data/mechanics/modelRules.json): battle noise
 *  battle.outcomeNoiseSigma 0.25 (was 0.15), river.riverCrossingDelayDays per era (was 0.5),
 *  collapse.armyCollapsePersonnelFraction 0.5 (0.4 until re-derived out of sample; was 0.1), collapse.armyCollapseMorale (0.2 at first,
 *  back to the model definition 0.15 after QA round 2), intel.fogStrengthError, c2.missionCommandDelayFactor, naval.blockadeSeaControlThreshold
 *  (all three unchanged at 0.5, 0.5, 0.6). OFF: the constants below. Measured: 20/15/22 -> 21/15/23
 *  (Six-Day War winner 0% -> 95% and 6 days, Tannenberg duration passes, Iraq 2003 46 -> 26 days;
 *  Yom Kippur winner 85% -> 70%, Gulf War loss ratio x4.9 -> x5.8). */
export const RULES_FROM_MODEL_RULES = true;

// Thresholds written into ENGINE.md as part of the model definition. The ones read from the
// model rules above are kept as the RULES_FROM_MODEL_RULES OFF values.
/** Lognormal sigma of per-round battle noise (ENGINE.md 4). */
export const BATTLE_NOISE_SIGMA = 0.15;
/** Extra days to cross a major river cell without a bridge (ENGINE.md 5). */
export const RIVER_DELAY_DAYS = 0.5;
/** Days until non-battle losses return to duty when ATTRITION_FROM_MODEL_RULES is OFF (ENGINE.md 8). */
export const RETURN_TO_DUTY_DAYS = 30;
/** Ring length for returns to duty: must exceed the longest returnToDutyDays (40, napoleonic). */
export const RETURN_RING_DAYS = 64;
/** Army collapse: personnel below this share of start, or side morale below the second (ENGINE.md 12). */
export const COLLAPSE_PERSONNEL_FRACTION = 0.1;
export const COLLAPSE_MORALE = 0.15;
/** Fog-of-war strength error (+/-) for enemies beyond scouting radius (ENGINE.md 10). */
export const FOG_STRENGTH_ERROR = 0.5;
/** mission_command multiplies order delay by this (ENGINE.md 10). */
export const MISSION_COMMAND_DELAY_FACTOR = 0.5;
/** Special-behaviour thresholds (ENGINE.md 4). */
export const PHALANX_FLANK_THRESHOLD = 0.6;
export const FEIGNED_RETREAT_INITIATIVE_THRESHOLD = 0.5;
/** Desertion starts at or below this morale (ENGINE.md 8). */
export const DESERTION_MORALE = 0.5;
/** Enemy sea control above this blockades and blocks sea movement (ENGINE.md 6). */
export const BLOCKADE_SEA_CONTROL = 0.6;
/** Tech thresholds named in ENGINE.md: air war from air tech 7, ammo/fuel combat factor
 *  from weapons tech 6, all-weather roads in own cropland/urban from logistics tech 3. */
export const AIR_MIN_TECH = 7;
export const SUPPLY_FACTOR_MIN_TECH = 6;
export const ROAD_MIN_TECH = 3;
export const PRECISION_MIN_TECH = 8;
/** Mass surrender: when an army collapses (personnel or morale), modelRules.surrender.
 *  encircledSurrenderShare (per era of each member) of its personnel still on the map is booked as
 *  captured. Pocket destruction (leaveCell, SURRENDER_SHARE_FROM_MODEL_RULES) already books the same
 *  share. QA round 2: Falklands prisoners 1.4k vs 12.6k, France 1940 Allied captured 67-99k vs 1.76M.
 *  Measured (20 seeds): 19/15/23 -> 19/14/23. France 1940 ratio x8.12 -> x4.08 (Allied losses 495k ->
 *  969k, hist 2.08M); Iraq 2003 x0.50 -> x0.24 fails (Iraqi 99k -> 209k vs hist 35k); Stalingrad
 *  x0.18 -> x0.09; Falklands morale-collapse seeds 1.6k -> 6.5k Argentine (median unchanged 8.1k, set
 *  by personnel-collapse seeds that have nothing left on the map). Kept ON: the share is sourced. */
export const COLLAPSE_SURRENDER = true;
/** Army collapse judged per member: a coalition side collapses only when every member that
 *  carries a real share of it has fallen below armyCollapsePersonnelFraction of what it fielded.
 *  OFF: the side's pooled personnel against its pooled fielded total, so the largest member
 *  decided for all (Germany 1944 vs Spain and Switzerland: the Swiss were 82% of the side and
 *  their collapse ended Spain's war too). One-member sides are judged the same either way.
 *  Measured (20 seeds): backtest 19/15/22 both ways, blind (no case has a coalition). Coalition
 *  presets A/B/draw OFF -> ON: Allies vs Axis 0/20/0 -> 0/2/18 (France breaks day 135, Germany
 *  257, Italy 518, Britain fights on), Persia vs Greeks 19/1/0 -> 14/5/1, Central Powers vs
 *  Entente 2/6/12 -> 0/5/15; Napoleon, NATO 1989 and USA+Spain vs Russia unchanged.
 *  KEPT-ON-NULL: the backtest cannot see it, the preset shifts go the historical way. */
export const MEMBER_COLLAPSE = true;
/** Members fielding less than this share of their side's total cannot keep a broken coalition in
 *  the war (a 500-man contingent would otherwise hold it open to the time limit). A judgment
 *  value, not sourced. */
export const MEMBER_COLLAPSE_MIN_SHARE = 0.1;
/** Battle breakpoint = modelRules.breakpoint.loserCasualtyShareAtBreak for the member's era
 *  (napoleonic sub-key for 1789-1849; CDB90 with the 24 backtest battles removed, Krentz and Sabin
 *  for iron), shifted by cohesion as before. Each seed draws one quantile u (its own stream, so the
 *  battle noise is untouched) and every member takes factor(MV, u): u 0 -> low, 0.5 -> mid, 1 -> high;
 *  SimOptions.breakpointQuantile fixes u (0.5 = deterministic mid). OFF: the tech-keyed
 *  morale.breakpoint table at mid. Measured (20 seeds, clean HEAD 65493a9): 20/14/22 -> 20/17/21.
 *  Gulf War x4.87 -> x2.71, Six-Day x3.33 -> x0.59 (winner 0% -> 45%), Waterloo x3.08 -> x2.53, Yom
 *  Kippur x0.44 -> x1.96 pass; El Alamein 4.9 -> 3.4 days fails; Kursk x3.96 -> x6.03. Fixed quantile:
 *  low 21/15/19, mid 20/17/20, high 21/16/23. */
export const BREAKPOINT_FROM_MODEL_RULES = true;
/** AI leftovers (formations not needed by any chosen objective) on a side whose case objective kind
 *  is 'hold' defend that objective (or the most threatened own place, else hold) instead of joining
 *  the nearest attack. The aggression >= 0.5 cutoff is unchanged. Measured (20 seeds): 20/17/21
 *  unchanged, no case moved. Iraq 2003 trace unchanged (15/22 Iraqi formations in Attack on day 1):
 *  its attacks are not leftovers but slot orders against the Coalition's case base, an 'enemy
 *  capital' candidate. */
export const LEFTOVERS_FOLLOW_OBJECTIVE = true;
/** A side whose case objective kind is 'hold' takes no enemy capital or city as an objective and
 *  moves to its own hold objective in Defend mode; enemy formations stay targets (counterattacks).
 *  In a case the enemy 'capital' is the synthesized start base, so Iraq 2003 sent 14 of 22
 *  formations at the Coalition's base. Measured (20 seeds): 20/17/21 -> 20/18/21; France 1940 ratio
 *  x3.03 -> x2.62 passes, winner 90% -> 85%. Seed 1 traces (Defend/Attack): Stalingrad Axis day 1
 *  6/28 -> 34/0, Gulf War Iraq day 6 4/5 -> 9/0, Falklands Argentina 0/1 -> 1/0; Iraq 2003 day 1
 *  0/15 -> 1/14: its attacks are now all against Coalition formations (Formation slots). */
export const HOLD_SIDE_NO_PLACE_TARGETS = true;
/** Pursuit mobile share counts manoeuvre roles only (cavalry, chariots, armour, IFV/APC, motorised
 *  infantry), as ENGINE.md defines it ("cavalry, vehicles, air"). Before, every role with a mounted
 *  mobility class counted, so wagon-drawn or towed artillery, which carries 70-88% of a WWII army's
 *  TLI, made the share 0.86-0.97 (Stalingrad Soviets 0.95, of which armour and cavalry 0.07) and
 *  pursuit took 41% of every beaten formation. Measured (20 seeds, clean worktrees, against
 *  8e1a1e8): without the doctrine re-basing (a61c9ba) 20/18/21 -> 21/15/22, with it 20/16/20 ->
 *  21/14/20. Stalingrad 7 -> 25 days (hist 75), France 1940 x2.62 -> x6.44 fails, Six-Day winner
 *  45% -> 65% (ratio x0.47 -> x0.27 fails), Kursk x6.03 -> x3.02, Waterloo x2.53 -> x1.91. */
export const PURSUIT_MANOEUVRE_ROLES_ONLY = true;
/** Pursuit mobile share: the air part is the battle's air share of the winner's power. Before, air
 *  power (battle units, divided by the enemy's dispersion) was added to raw-TLI ground weights, so
 *  at WWII-and-later dispersion air counted for almost nothing in the pursuit. Measured (20 seeds,
 *  clean worktree at cab91ee): 21/14/20 -> 20/15/20. France 1940 x6.31 -> x3.42 and 43 -> 37 days,
 *  Gulf War x2.65 -> x2.29; Six-Day winner 65% -> 55% fails; Stalingrad 24 -> 21 days. */
export const PURSUIT_AIR_SAME_UNITS = true;
/** Surprise (BattleSide.surprise, combat.surpriseFactor) applies only to battles on day 1, the
 *  opening of the offensive. Before, it multiplied the first battle of every fresh formation for
 *  the whole campaign (QA round 3, C6). Measured (20 seeds, clean 69b3d1a): 20/15/20 unchanged;
 *  France 1940 95% -> 85%, Gulf War x2.29 -> x3.00 (at the edge), Yom Kippur 25% -> 45%. */
export const SURPRISE_DAY_ONE_ONLY = true;
/** morale.capitalLossShock fires only for a real capital, not for a backtest case's synthesized
 *  start base (SimOptions.syntheticCapitals). No case field marks a real capital today, so the
 *  shock does not fire in backtest cases (Stalingrad seed 1: -0.10 side morale on day 4 when the
 *  Axis base fell). Decision logged in DECISIONS.md. Measured (20 seeds, clean a7049e7): 20/15/20
 *  unchanged; Six-Day winner 55% -> 0% (ratio x0.39 -> x1.03), Iraq 2003 x0.13 -> x0.26. */
export const CAPITAL_SHOCK_REAL_ONLY = true;
/** A side does not take an attack slot it cannot staff to its doctrine's required ratio: when the
 *  side's whole remaining power (not yet ordered this cycle) is below the slot's need, the slot is
 *  skipped, leftovers do not join it, and the formations it would have drawn defend the side's own
 *  objective if it holds it, else the nearest own place (DECISIONS.md, round 3 item 8). Before, the
 *  loop gave such a slot everything (Iraq 2003: 14 of 22 formations at an enemy group needing
 *  2.7x their power). Measured (20 seeds, clean 0ca9c26): 20/15/20 -> 20/15/21. Iraq 2003 seed 1
 *  day 1 Iraqi Defend/Attack 1/14 -> 15/0, winner 100% -> 90%; Yom Kippur 45% -> 0% (Israel, 1-3
 *  formations, never attacks), ratio x0.17 -> x2.37 passes; Stalingrad 23 -> 31 days passes; Gulf
 *  War ratio x3.00 -> x3.08 fails. Presets (12 x 2 seeds, invariants clean): 6 runs change winner,
 *  allies-vs-axis-minus-two and mongols-vs-rome both seeds and usa-vs-china-2026 seed 1 to draws,
 *  rome-vs-france-equalized seed 1 to Rome. */
export const AI_SKIP_UNSTAFFABLE_ATTACKS = true;
/** Daily weather is drawn from the theater's Koppen-Geiger zone table (movement.weatherOddsByZone:
 *  A, BW, BS, C, D, E), the zone being the majority over the theater's land cells on the Beck et al.
 *  2018 0.5 deg map (public/data/climate/zones.bin), zone C without the map. Before, every theater
 *  used one temperate table derived for Berlin (QA C7: the Gulf War drew snow on 22% of February
 *  days). Measured (20 seeds, clean facfd50, no zone grid built yet, so every theater draws zone C):
 *  19/17/22 unchanged; France 1940 95% -> 90%, Gulf War 8 -> 9 days, Stalingrad 31 -> 30 days.
 *  With the grid (20 seeds, clean e615341): 17/14/21 -> 18/13/21. Gulf War (BW) winner 50% -> 85%
 *  passes, ratio x2.98 -> x3.19 fails; Yom Kippur (BW) 15% -> 0%; Falklands (E) 9 -> 12 days; Iraq
 *  2003 (BW) 21 -> 19 days. Gulf War run in February: snow on 0 of 175 days (50 of 186, 26.9%, on
 *  zone C). Zones: BW Gulf, Iraq, El Alamein, Six-Day, Yom Kippur; BS Stalingrad, Cannae, Zama (24:24
 *  tie with C, first in order); E Falklands; D Austerlitz, Blenheim, Breitenfeld, Gettysburg, Kursk,
 *  Mohi, Tannenberg; C the other eight. */
export const REGIONAL_WEATHER = true;
/** The AI's attack staffing is local and in combat power: an attack slot needs the doctrine's
 *  ratio times the enemy power within engagement reach of the target cell (the cell and its 8
 *  neighbours, two rings against corps_system), and both sides are rated with the battle model's
 *  power (combat.ts aiPower: count x TLI x quality x training x command x tech factors) instead of
 *  raw weapon weight. The unstaffable-attack test is against the side's whole available power less
 *  what its defend slots needed. Before, the need was the ratio times a 3x3-sector enemy group in
 *  raw weight and the test ran against what the defend slots had left (QA round 4: Allies at 3x
 *  never attack, Israel never attacks locally). An attack a member cannot fill to its need from free
 *  formations is not launched. Measured (20 seeds, clean 73fa63c): 19/17/22 -> 19/17/21; France
 *  1940 90% -> 100%, 56 -> 36 days; Iraq 2003 x0.26 -> x0.12; Stalingrad 30 -> 21 days fails; Yom
 *  Kippur still 0% (17 of 20 draws), ratio x2.27 -> x0.70. Presets (24 runs, invariants clean):
 *  allies-vs-axis-minus-two draw -> Axis (the Axis is 1.5x the Allies in combat power and attacks),
 *  macedon-vs-persia both seeds and rome-vs-france-equalized seed 2 flip to the defender;
 *  mongols-vs-rome, usa-vs-china, usa-spain-vs-russia and japan-vs-usa stay draws. */
export const AI_LOCAL_COMBAT_POWER_STAFFING = true;
/** A formation withdraws in good order at this share of its breakpoint, just before the rout. The
 *  relation the engine always used (the 0.9 cap on the doctrine threshold), now named. */
export const WITHDRAW_SHARE_OF_BREAKPOINT = 0.9;
/** The doctrine moves the break point both ways: breakpoint = doctrine retreatThreshold x
 *  bp_era(u) / bp_era(mid) + the cohesion shift, u being the per-seed breakpoint quantile, and
 *  withdrawal at WITHDRAW_SHARE_OF_BREAKPOINT of it. Before, the era draw was the break and the
 *  doctrine only set the withdrawal, capped at 0.9 x the break, so every high-quartile ("holds")
 *  threshold was inert (QA round 4). A neutral doctrine (no profile) breaks at the era mid.
 *  Measured (20 seeds, clean 1150d3f, doctrine data as committed there): 19/17/21 -> 17/11/20.
 *  Low-quartile doctrines now rout where they used to withdraw: Gulf War 95% -> 50% (coalition
 *  coldwar-western breaks at 4.5%), El Alamein 55% -> 10% (british-ww2 5.9%), Mohi 80% -> 15%
 *  (mongol-steppe 8%), Carrhae 45% -> 0%, France 1940 x1.85 -> x4.05; Adrianople 90% -> 10%
 *  (roman-imperial holds to 25%); Marathon 50% -> 85%. Fixed quantile low/mid/high: 17/15/19,
 *  18/13/20, 16/10/24 (was 20/18/19, 21/18/21, 20/16/21). Presets (24 runs, invariants clean):
 *  rome-vs-france-equalized seed 1 and macedon-vs-persia seed 1 change winner. */
export const SYMMETRIC_DOCTRINE_BREAKPOINT = true;
/** The doctrine-scaled break stays inside its era's breakpoint range (low..high), before the
 *  cohesion shift. Without it a doctrine already high in its era is scaled past the sourced high:
 *  Iraq 1991, 0.154 x 0.30 / 0.10 = 0.462 at quantile 1, against an era high of 0.30, which ran the
 *  Gulf War out of its time limit. Chosen after seeing that result (VALIDATION.md, Diagnosis: the
 *  high era breakpoint), so its campaign is not pooled with earlier ones.
 *  Measured (20 seeds, clean 6928165): 18/13/22 -> 19/15/22. Gulf War 90% -> 100%, Adrianople 10% ->
 *  65%, France 70% -> 80%, Mohi 15% -> 30%. Fixed quantile low 17/15/20 unchanged; high 16/13/24 ->
 *  17/15/24, Gulf War and Adrianople pass, Zama falls under the line (72.5% at 40 seeds): at u = 1 a
 *  doctrine at the era high and one at the mid both pin at the high, so the doctrine edge is gone.
 *  Presets (24 runs, invariants clean): no winner changes. */
export const ERA_CLAMPED_BREAKPOINT = true;
/** The AI's required force ratios are modelRules.aiForceRatio.{attrition, maneuver} (FM 5-0, FM
 *  100-2-1, Mearsheimer 1989; grade B and C), drawn per seed at one quantile u from a stream of
 *  their own (seed ^ 0x27d4eb2f), independent of the breakpoint draw; SimOptions.ratioQuantile
 *  fixes u (scripts/backtest.ts --ratio-quantile). OFF: the code constants 3.0 and 1.5 (the mids).
 *  Measured (20 seeds, clean 27c49c5): 18/13/21 unchanged; Yom Kippur 0% -> 25%, France 1940 80% ->
 *  75% and 50 -> 57 days, Stalingrad 21 -> 24 days. Fixed quantile low/mid/high: 18/12/21,
 *  18/13/21, 18/13/22. Presets (24 runs, invariants clean): rome-vs-france-equalized seed 2 and
 *  macedon-vs-persia seed 1 change winner. */
export const AI_RATIOS_FROM_MODEL_RULES = true;
/** The seasonal march factor is daylight: min(1, sunrise-to-sunset hours at the theater's centre
 *  latitude on the sim date / movement.marchHoursPerDay), the march-hours basis of FM 101-10 (1941)
 *  par. 38 (6 h for a foot division). Spencer 1971 declination, NOAA 90.833 deg sunrise zenith
 *  (src/engine/daylight.ts). Mud, rain and snow stay in the zone weather. OFF: movement.season, a
 *  Berlin-latitude table (winter 0.7 from ~8 h vs ~16 h of daylight) applied at every latitude
 *  (QA round 5: winter 0.4 flips the Gulf War). Sunrise to sunset never falls below 6 h in
 *  any backtest or preset theater (shortest: Stalingrad January 8.4 h, Falklands July 7.8 h), so
 *  the factor is 1 throughout and the change removes the old spring 0.85, autumn 0.9 and winter
 *  0.7. Measured (20 seeds, clean f991a6e): 18/13/21 unchanged; Gulf War 85% -> 90%, ratio x3.19
 *  -> x3.01 (still fails), 9 -> 8 days; Falklands 12 -> 9 days; Iraq 2003 19 -> 17 days; France
 *  1940 75% -> 70%, x3.88 -> x5.10. Presets (24 runs, invariants clean): rome-vs-france-equalized
 *  seed 1 changes winner. */
export const DAYLIGHT_MARCH_HOURS = true;
/** Initial control (ENGINE.md section 2.5): land both sides' polygons claim starts contested
 *  (neutral, either side deploys at its own places there); a capital cell and its 8-neighbour ring
 *  go to the side whose capital it is, a capital cell both sides share stays contested. OFF: the
 *  nearer capital takes every overlap and side 0 wins a tie, so a cross-era matchup started with
 *  the defender's capital enemy-held and ended on day 1 without a battle (red team C4). Measured
 *  (20 seeds each, with CAPITAL_CAPTURE_NEEDS_REACH): Egypt 1274 BCE vs Israel 2026 Egypt 20/20 on
 *  day 1 -> Israel 20/20, days 4-13; Rome 117 vs Italy 2026 Rome 20/20 day 1 -> Italy 20/20 day 1
 *  after a battle in Rome; Aztecs vs Mexico 2026 Aztecs 20/20 day 1 -> Mexico 20/20 day 1 by Aztec
 *  army collapse. Backtest (voronoi start control, untouched) 18/13/21 unchanged. Presets (12 x 2
 *  seeds): winners unchanged; rome-117-vs-spain-2026 81/86 -> 76/66 days, rome-vs-france-equalized
 *  187/150 -> 123/128 days. */
export const CONTESTED_START_OVERLAP = true;
/** A capital counts as captured only once an enemy formation has been on it or next to it (the
 *  besieger whose zone of control takes a reduced fortress) since the enemy took it; a capital that
 *  passed by encirclement alone does not. ENGINE.md section 12 defines capture as an enemy
 *  formation holding the cell. Requiring the formation ON the cell was rejected: United Kingdom vs
 *  Iceland, Reykjavik is reduced and taken from the next cell on day 45. Backtest 18/13/21
 *  unchanged. */
export const CAPITAL_CAPTURE_NEEDS_REACH = true;
/** A capital cell inside the theater is its own member's at the start even when no border polygon
 *  covers it (needs CONTESTED_START_OVERLAP). A state smaller than a cell (Andorra) had a neutral
 *  capital: no AI objective (only enemy-held places are) and never "held by the enemy", so the war
 *  could not end by capital capture (red team W5). Measured (20 seeds, alone): Andorra vs Spain 2026
 *  draw 20/20 on day 120 -> Spain 20/20 on day 89 after a siege of the empty town. Backtest
 *  (voronoi start control) unaffected; presets unchanged. */
export const CAPITAL_CELL_OWN_AT_START = true;
/** A fortified place is protected (cannot be entered, falls only to siege) only while the member
 *  it belongs to has a formation alive somewhere, or one stands on it. Before, an unarmed state's
 *  capital still needed daysToReduce (Nicaragua vs an empty San Jose: about 0.002/day, and the
 *  besieger fell back to resupply every few days, red team W5). Measured (20 seeds, with
 *  CAPITAL_CELL_OWN_AT_START): Andorra vs Spain Spain day 89 -> day 5; Iceland vs UK 2026 (theater
 *  reaching Reykjavik) UK day 38-45 -> 17-24; Costa Rica vs Nicaragua 2026 (theater reaching San
 *  Jose) Nicaragua 17/20 at day 228-466, 3 Costa Rica -> Nicaragua 20/20, days 20-133 (median 78;
 *  Costa Rica's recruits garrison it later). Rejected: open every place with no formation ON it.
 *  USA took an empty Beijing on day 67 and NATO an empty Moscow, both seeds, and the Gulf War
 *  winner fell 90% -> 55%: a state with an army defends its cities beyond its field formations.
 *  This rule: backtest 18/13/21 unchanged, presets unchanged. */
export const UNARMED_FORTRESS_OPEN = true;
