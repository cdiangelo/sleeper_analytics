/**
 * Shapes returned by the Sleeper API, narrowed to the fields this app reads.
 * Sleeper is loosely typed and adds fields freely, so every interface here is
 * a subset — never assume a response has only these keys.
 */

export interface NflState {
  week: number;
  season: string;
  season_type: string;
  season_start_date: string;
  display_week?: number;
  leg?: number;
}

export type ScoringSettings = Record<string, number>;

export interface League {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: ScoringSettings;
  settings: Record<string, number>;
  previous_league_id?: string | null;
  draft_id?: string;
}

export interface LeagueUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: {
    team_name?: string;
    avatar?: string;
    [k: string]: unknown;
  };
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  keepers: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
    total_moves?: number;
    [k: string]: number | undefined;
  };
}

export interface Matchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  custom_points: number | null;
  starters: string[] | null;
  starters_points: number[] | null;
  players: string[] | null;
  players_points: Record<string, number> | null;
}

export type TransactionType = "free_agent" | "waiver" | "trade" | "commissioner";

export interface Transaction {
  transaction_id: string;
  type: TransactionType;
  status: string;
  status_updated: number;
  created: number;
  leg: number;
  roster_ids: number[];
  /** player_id -> roster_id that received them */
  adds: Record<string, number> | null;
  /** player_id -> roster_id that dropped them */
  drops: Record<string, number> | null;
  draft_picks: unknown[];
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }>;
  settings: { waiver_bid?: number; seq?: number; [k: string]: number | undefined } | null;
  metadata?: { notes?: string; [k: string]: unknown } | null;
}

export interface DraftPick {
  draft_id: string;
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number | null;
  picked_by: string;
  player_id: string;
  is_keeper: boolean | null;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    injury_status?: string;
    years_exp?: string;
    number?: string;
    [k: string]: unknown;
  };
}

export interface Draft {
  draft_id: string;
  league_id: string;
  status: string;
  type: string;
  season: string;
  settings: {
    teams: number;
    rounds: number;
    slots_wr?: number;
    [k: string]: number | undefined;
  };
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number> | null;
}

/** Raw player record from /v1/players/nfl — hundreds of fields, we read a few. */
export interface RawPlayer {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  injury_status?: string | null;
  number?: number | null;
  status?: string | null;
  active?: boolean;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  years_exp?: number | null;
  search_rank?: number | null;
}

/** Trimmed player index entry — what we actually cache and ship (~1MB total). */
export interface Player {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  injury: string | null;
  number: number | null;
  depthOrder: number | null;
  rank: number | null;
}

export type PlayerIndex = Record<string, Player>;

export interface TrendingPlayer {
  player_id: string;
  count: number;
}

export interface ProjectionPlayer {
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  injury_status?: string | null;
}

export interface Projection {
  player_id: string;
  opponent?: string | null;
  game_id?: string;
  team?: string | null;
  week?: number;
  season?: string;
  player?: ProjectionPlayer;
  /** Empty object before projections publish for the week. */
  stats: Record<string, number>;
}

/**
 * Everything the app needs, fetched once and normalized. This is the shape the
 * dump script writes to fixtures/league-state.json and the shape the UI reads.
 */
export interface LeagueSnapshot {
  /** ISO timestamp the snapshot was taken. */
  fetchedAt: string;
  state: NflState;
  league: League;
  users: LeagueUser[];
  rosters: Roster[];
  draft: Draft | null;
  draftPicks: DraftPick[];
  /** week -> matchup rows. Only weeks that have been played are present. */
  matchups: Record<number, Matchup[]>;
  /** week -> transactions for that week. */
  transactions: Record<number, Transaction[]>;
  trendingAdds: TrendingPlayer[];
  /** Projections for the upcoming week, keyed by player_id. May be empty. */
  projections: Record<string, Projection>;
  /** Non-fatal problems hit while fetching, surfaced in the UI as warnings. */
  warnings: string[];
}
