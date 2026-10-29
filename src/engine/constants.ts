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

// Thresholds written into ENGINE.md as part of the model definition. They are
// model rules rather than measured quantities, but they shape outcomes, so
// they are candidates for the mechanics contract (listed in the engine report).
/** Lognormal sigma of per-round battle noise (ENGINE.md 4). */
export const BATTLE_NOISE_SIGMA = 0.15;
/** Extra days to cross a major river cell without a bridge (ENGINE.md 5). */
export const RIVER_DELAY_DAYS = 0.5;
/** Days until non-battle losses return to duty (ENGINE.md 8). */
export const RETURN_TO_DUTY_DAYS = 30;
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
