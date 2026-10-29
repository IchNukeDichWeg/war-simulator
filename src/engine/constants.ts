// Model-plumbing constants. None of these is a real-world quantity: they set
// grid resolution, planning cadence, bookkeeping and output throttling.
// Real-world constants live in the Mechanics object (public/data/mechanics.json).

/** Theater cells above this are merged k x k (ENGINE.md 2.4). */
export const MAX_THEATER_CELLS = 20000;
/** Replay keyframe interval in days (ENGINE.md 14). */
export const KEYFRAME_DAYS = 30;
/** Base command re-plan interval in days, before coalition friction. */
export const AI_CYCLE_DAYS = 5;
/** Candidate objectives (each gets a flow field) per side and cycle. */
export const AI_MAX_OBJECTIVES = 12;
/** Enemy formations are clustered on a coarse grid of about this many sectors per axis. */
export const AI_SECTORS_PER_AXIS = 12;
/** Desired local force ratio the AI masses before attacking: attrition doctrine (maneuver 0)
 *  vs maneuver doctrine (maneuver 1). AI behaviour weights, not combat physics. */
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
 *  OFF: measured negative alone, 20/15/22 -> 20/14/22 (Yom Kippur winner 85 -> 100% but its loss
 *  ratio x2.44 -> x3.28). */
export const CASE_SUPPLY_RANGE_FROM_SNAPSHOT = false;
/** With a borrowed supply range, campaign backtests run with the supply rule on (it was off in all
 *  24 cases, so the logistics layer was never validated).
 *  OFF: with the borrowed range it measured 20/14/22 and Iraq 2003 fell from 85% to 65%, 54 days. */
export const CASE_SUPPLY_RULE_ON = false;
/** A case's synthesized 'capital' (its main start position) is an ordinary place, not a fortress:
 *  a fortified one added a siege (daysToReduce) where the objective sat on it (QA C5).
 *  OFF: measured negative alone, 20/15/22 -> 20/14/22: Iraq 2003 improves (100%, 24 days vs 21
 *  historical, ratio x0.76) but Stalingrad's loss ratio goes x1.79 -> x0.19. */
export const CASE_CAPITAL_UNFORTIFIED = false;
/** Objective kind from the case (objective.kind 'capture' | 'hold') instead of inferring it from the
 *  nearest-start control split; a capture objective is taken when an own formation stands on it
 *  with no enemy there (QA C6). Cases without kind keep the inferred rule. No case sets a kind
 *  yet, so it measures neutral (20/15/22). */
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

// Thresholds written into ENGINE.md as part of the model definition. They are
// model rules rather than measured quantities, but they shape outcomes, so
// they are candidates for the mechanics contract (listed in the engine report).
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
