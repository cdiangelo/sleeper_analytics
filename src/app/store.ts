/**
 * Loads everything the screens need, through the cache layer.
 *
 * All Sleeper calls happen here, client-side, straight from the browser. There
 * is no backend in this path: Sleeper is CORS-open and unauthenticated, so the
 * hosted static site talks to it directly and scores are live.
 */

import {
  cached,
  cachedBlob,
  describeAge,
  readBlob,
  TTL,
  writeBlob,
  type Staleness,
} from "../lib/cache.js";
import {
  FAAB_BUDGET,
  LEAGUE_ID,
  DRAFT_ID,
  PREV_LEAGUE,
  ROSTER_ID,
} from "../lib/constants.js";
import { startingSlots } from "../lib/metrics.js";
import {
  allRosteredPlayers,
  buildTeams,
  reconcileRosters,
  reconstructRosters,
  type Reconciliation,
  type Team,
} from "../lib/normalize.js";
import { verifyScoring, type ScoringMismatch } from "../lib/scoring.js";
import {
  getDraftPicks,
  getLeague,
  getLeagueUsers,
  getMatchups,
  getNflState,
  getProjections,
  getRawPlayers,
  getRosters,
  getTransactions,
  getTrendingAdds,
  trimPlayerIndex,
} from "../lib/sleeper.js";
import type {
  DraftPick,
  League,
  LeagueUser,
  Matchup,
  NflState,
  PlayerIndex,
  Projection,
  Roster,
  Transaction,
  TrendingPlayer,
} from "../lib/types.js";

export interface AppState {
  state: NflState;
  league: League;
  users: LeagueUser[];
  rosters: Roster[];
  teams: Team[];
  slots: string[];
  draftPicks: DraftPick[];
  matchups: Record<number, Matchup[]>;
  transactions: Transaction[];
  trending: TrendingPlayer[];
  projections: Record<string, Projection>;
  /**
   * Projections for further weeks, keyed by week then player_id. Populated on
   * demand only: one week is ~2MB over the wire, so eagerly loading a season
   * would cost ~34MB on a phone.
   */
  projectionsByWeek: Record<number, Record<string, Projection>>;
  players: PlayerIndex;
  /** True while the shipped index is in use and the live one is still loading. */
  playersProvisional: boolean;
  /** Last season's final standings, or null if the prior league is gone. */
  prevSeason: { season: string; teams: Team[] } | null;
  reconciliation: Reconciliation;
  scoringMismatches: ScoringMismatch[];
  /** Age of the most time-sensitive thing on screen: the live scores. */
  scoresFetchedAt: number;
  errors: string[];
}

export function myRosterId(): number {
  return ROSTER_ID;
}

export function staleness(state: AppState): Staleness {
  return describeAge(state.scoresFetchedAt);
}

/**
 * Player index, cheapest source first.
 *
 * The ~10MB live index is the source of truth, but it is a bad first
 * impression. The build ships a pre-trimmed copy (~500KB) that renders
 * immediately; the live one refreshes in the background and lands in
 * IndexedDB for next time.
 */
async function loadPlayers(
  onLiveIndex: (index: PlayerIndex) => void,
): Promise<{ players: PlayerIndex; provisional: boolean }> {
  const KEY = "players/nfl";

  const hit = await readBlob<PlayerIndex>(KEY);
  if (hit && Date.now() - hit.fetchedAt < TTL.players) {
    return { players: hit.data, provisional: false };
  }

  // Refresh from Sleeper without blocking first paint.
  const live = (async () => {
    const index = trimPlayerIndex(await getRawPlayers());
    await writeBlob(KEY, index);
    return index;
  })();

  // Attach a handler now, synchronously. Every branch below awaits something
  // first, and a rejection landing in that window would otherwise surface as
  // an unhandled rejection even though the failure is recoverable.
  live.catch(() => {});

  if (hit) {
    // Expired but usable: show it now, swap when the fresh one lands.
    void live.then(onLiveIndex).catch(() => {});
    return { players: hit.data, provisional: true };
  }

  // Cold start. Race the shipped asset against the live fetch.
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}players.json`);
    if (res.ok) {
      const shipped = (await res.json()) as PlayerIndex;
      void live.then(onLiveIndex).catch(() => {});
      return { players: shipped, provisional: true };
    }
  } catch {
    // Fall through to the live fetch.
  }

  return { players: await live, provisional: false };
}

export interface LoadOptions {
  force?: boolean;
  /** Called when the background player-index refresh completes. */
  onPlayerIndex?: (index: PlayerIndex) => void;
}

export async function loadAll(opts: LoadOptions = {}): Promise<AppState> {
  const { force = false } = opts;
  const errors: string[] = [];

  const soft = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  };

  const stateHit = await cached("state", TTL.state, getNflState, { force });
  const state = stateHit.data;
  const week = Math.max(1, state.week);

  const [leagueHit, usersHit, rostersHit] = await Promise.all([
    cached("league", TTL.league, () => getLeague(LEAGUE_ID), { force }),
    cached("users", TTL.users, () => getLeagueUsers(LEAGUE_ID), { force }),
    cached("rosters", TTL.rosters, () => getRosters(LEAGUE_ID), { force }),
  ]);

  const draftPicks = await soft(
    "draft",
    async () =>
      (await cached("draft/picks", TTL.draft, () => getDraftPicks(DRAFT_ID), { force }))
        .data,
    [] as DraftPick[],
  );

  // Past weeks are settled and cached for a day; the current week is the one
  // that moves during games and gets the 60-second TTL.
  const matchups: Record<number, Matchup[]> = {};
  let scoresFetchedAt = Date.now();

  for (let w = 1; w <= week; w++) {
    const isCurrent = w === week;
    const hit = await soft(
      `matchups w${w}`,
      () =>
        cached(
          `matchups/${w}`,
          isCurrent ? TTL.matchupsLive : TTL.matchupsFinal,
          () => getMatchups(LEAGUE_ID, w),
          { force },
        ),
      null,
    );
    if (!hit) continue;
    if (hit.data.length > 0) matchups[w] = hit.data;
    if (isCurrent) scoresFetchedAt = hit.fetchedAt;
  }

  const transactions: Transaction[] = [];
  for (let w = 1; w <= week; w++) {
    const rows = await soft(
      `transactions w${w}`,
      async () =>
        (
          await cached(
            `transactions/${w}`,
            TTL.transactions,
            () => getTransactions(LEAGUE_ID, w),
            { force },
          )
        ).data,
      [] as Transaction[],
    );
    transactions.push(...rows);
  }

  const trending = await soft(
    "trending",
    async () =>
      (await cached("trending/add", TTL.trending, () => getTrendingAdds(24, 60), { force }))
        .data,
    [] as TrendingPlayer[],
  );

  const projections = await soft(
    "projections",
    async () =>
      (
        await cachedBlob(
          `projections/${state.season}/${week}`,
          TTL.projections,
          () => getProjections(state.season, week),
          { force },
        )
      ).data,
    {} as Record<string, Projection>,
  );

  // Last season is finished and immutable, so it is fetched once and held for
  // a month. This is optional context: if the prior league is gone or fails to
  // load, the card is simply absent. It must not raise an error banner, which
  // is reserved for data the screens actually need.
  let prevSeason: AppState["prevSeason"] = null;
  try {
    const [prevLeague, prevUsers, prevRosters] = await Promise.all([
      cached(`prev/league`, TTL.prevSeason, () => getLeague(PREV_LEAGUE)),
      cached(`prev/users`, TTL.prevSeason, () => getLeagueUsers(PREV_LEAGUE)),
      cached(`prev/rosters`, TTL.prevSeason, () => getRosters(PREV_LEAGUE)),
    ]);
    prevSeason = {
      season: prevLeague.data.season,
      teams: buildTeams(
        prevUsers.data,
        prevRosters.data,
        prevLeague.data.settings.waiver_budget ?? FAAB_BUDGET,
      ),
    };
  } catch {
    prevSeason = null;
  }

  const { players, provisional } = await loadPlayers(
    opts.onPlayerIndex ?? (() => {}),
  );

  const league = leagueHit.data;
  const rosters = rostersHit.data;

  const rebuilt = reconstructRosters(draftPicks, transactions);
  const reconciliation = reconcileRosters(rebuilt, rosters);

  return {
    state,
    league,
    users: usersHit.data,
    rosters,
    teams: buildTeams(usersHit.data, rosters, league.settings.waiver_budget ?? FAAB_BUDGET),
    slots: startingSlots(league.roster_positions),
    draftPicks,
    matchups,
    transactions,
    trending,
    projections,
    projectionsByWeek: { [week]: projections },
    players,
    playersProvisional: provisional,
    prevSeason,
    reconciliation,
    scoringMismatches: verifyScoring(league.scoring_settings),
    scoresFetchedAt,
    errors,
  };
}

/** How many weeks ahead the on-demand projection load reaches. */
export const PROJECTION_HORIZON = 4;

/**
 * Fetch projections for the weeks after the current one, for the season chart.
 *
 * Deliberately not part of the initial load. Each week is roughly 2MB over the
 * wire and only a handful of players are ever plotted, so the response is
 * trimmed to the requested ids before being cached — 18KB a week instead of
 * two megabytes.
 */
export async function loadProjectionHorizon(
  season: string,
  fromWeek: number,
  keep: Set<string>,
  onWeek?: (week: number, loaded: number, total: number) => void,
): Promise<Record<number, Record<string, Projection>>> {
  const out: Record<number, Record<string, Projection>> = {};
  const weeks: number[] = [];
  for (let w = fromWeek; w < fromWeek + PROJECTION_HORIZON && w <= 17; w++) {
    weeks.push(w);
  }

  for (const [i, week] of weeks.entries()) {
    try {
      const hit = await cachedBlob(
        `projections/${season}/${week}/roster`,
        TTL.projections,
        async () => {
          const all = await getProjections(season, week);
          const trimmed: Record<string, Projection> = {};
          for (const id of keep) {
            const row = all[id];
            if (row) trimmed[id] = row;
          }
          return trimmed;
        },
      );
      out[week] = hit.data;
    } catch {
      // A missing week leaves a gap in the line rather than failing the chart.
    }
    onWeek?.(week, i + 1, weeks.length);
  }

  return out;
}

/** Every player currently on a roster, for the free-agent set. */
export function rosteredPlayers(state: AppState): Set<string> {
  return allRosteredPlayers(state.rosters);
}
