/**
 * League identity. Verified against live Sleeper responses on 2026-09-06.
 */
export const LEAGUE_ID = "1389707069342388224"; // 2026
export const PREV_LEAGUE = "1257104727066292224"; // 2025
export const DRAFT_ID = "1389707069342388225"; // 2026
export const USER_ID = "869751169797529600"; // TDCity69
export const ROSTER_ID = 5; // Sand Francisco
export const DRAFT_SLOT = 9;

export const TEAM_COUNT = 10;
export const DRAFT_ROUNDS = 17;

/**
 * Starting lineup, in Sleeper's `roster_positions` order. BN/IR are excluded
 * here; the optimal-lineup solver only ever fills these.
 */
export const STARTER_SLOTS = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "FLEX",
  "K",
  "DEF",
] as const;

export const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);

export const PLAYOFF_START_WEEK = 15;
export const TRADE_DEADLINE_WEEK = 11;
export const FAAB_BUDGET = 100;
export const REGULAR_SEASON_WEEKS = 14;

/**
 * roster_id -> team identity. Sleeper's own `metadata.team_name` is
 * authoritative at runtime; this is the fallback for unnamed teams and for
 * rendering before /users resolves.
 */
export const ROSTER_DIRECTORY: Record<
  number,
  { team: string; owner: string; draftSlot: number }
> = {
  1: { team: "Tractorcito", owner: "homelander100", draftSlot: 10 },
  2: { team: "Dart Vader", owner: "TPickems", draftSlot: 6 },
  3: { team: "Butternut Josh", owner: "WiseJackalope", draftSlot: 4 },
  4: { team: "Rock the Gasper", owner: "MickeyChicken", draftSlot: 2 },
  5: { team: "Sand Francisco", owner: "TDCity69", draftSlot: 9 },
  6: { team: "A Team Has No Name", owner: "bskin22", draftSlot: 5 },
  7: { team: "PrinceSpaghetti", owner: "PrinceSpaghetti", draftSlot: 3 },
  8: { team: "Chappy's Cafe", owner: "sspeer216", draftSlot: 8 },
  9: { team: "HH", owner: "HHersey", draftSlot: 1 },
  10: { team: "0-1 2026 Keeper", owner: "motherduck", draftSlot: 7 },
};

/**
 * Expected scoring weights (spec section 4). NOT used for math — scoring is
 * always read from the live league endpoint. These exist purely as an
 * assertion so a silent upstream change to league settings gets surfaced
 * instead of quietly rewriting every number in the app.
 */
export const EXPECTED_SCORING: Record<string, number> = {
  rec: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  rec_40p: 1,
  rec_td_40p: 1,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_td_40p: 1,
  pass_cmp_40p: 1,
  rush_yd: 0.1,
  rush_td: 6,
  rush_40p: 1,
  rush_td_40p: 1,
  fum_lost: -2,
  fum_rec: 2,
  fum_rec_td: 6,
  bonus_rec_yd_100: 2,
  bonus_rec_yd_200: 4,
  bonus_rush_yd_100: 2,
  bonus_rush_yd_200: 4,
  bonus_pass_yd_300: 1,
  bonus_pass_yd_400: 2,
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50p: 5,
  xpm: 1,
  fgmiss: -1,
  xpmiss: -1,
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
  sack: 1,
  int: 2,
  ff: 1,
  safe: 2,
  blk_kick: 2,
  def_td: 6,
  def_st_td: 6,
  st_td: 6,
};

/**
 * 2026 keepers, league-wide, with the round they cost this year. Used to
 * verify draft parsing and to project 2027 keeper cost (round - 2).
 */
export const KEEPERS_2026: Array<{ player: string; round: number }> = [
  { player: "Puka Nacua", round: 3 },
  { player: "Nico Collins", round: 4 },
  { player: "De'Von Achane", round: 6 },
  { player: "Jaxon Smith-Njigba", round: 6 },
  { player: "Chris Olave", round: 6 },
  { player: "Chase Brown", round: 7 },
  { player: "Colston Loveland", round: 8 },
  { player: "Javonte Williams", round: 9 },
  { player: "Drake Maye", round: 10 },
  { player: "Michael Pittman", round: 10 },
];

/** Keeper cost escalates: next year's round is this year's minus two. */
export const KEEPER_ESCALATION = 2;
/** Undrafted waiver pickups are treated as roughly a 7th-round keeper cost. */
export const WAIVER_KEEPER_ROUND = 7;
