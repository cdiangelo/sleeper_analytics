/**
 * Typed wrappers over the Sleeper HTTP API.
 *
 * Everything here is CORS-open and unauthenticated, so it runs identically in
 * the browser and in Node. No backend is involved in any Sleeper call.
 */

import { getJSON, type GetOptions } from "./http.js";
import type {
  Draft,
  DraftPick,
  League,
  LeagueUser,
  Matchup,
  NflState,
  PlayerIndex,
  Projection,
  RawPlayer,
  Roster,
  Transaction,
  TrendingPlayer,
} from "./types.js";

export const BASE = "https://api.sleeper.app";

export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

export function getNflState(o?: GetOptions): Promise<NflState> {
  return getJSON<NflState>(`${BASE}/v1/state/nfl`, o);
}

export function getLeague(leagueId: string, o?: GetOptions): Promise<League> {
  return getJSON<League>(`${BASE}/v1/league/${leagueId}`, o);
}

export function getLeagueUsers(leagueId: string, o?: GetOptions): Promise<LeagueUser[]> {
  return getJSON<LeagueUser[]>(`${BASE}/v1/league/${leagueId}/users`, o);
}

export function getRosters(leagueId: string, o?: GetOptions): Promise<Roster[]> {
  return getJSON<Roster[]>(`${BASE}/v1/league/${leagueId}/rosters`, o);
}

export function getMatchups(
  leagueId: string,
  week: number,
  o?: GetOptions,
): Promise<Matchup[]> {
  return getJSON<Matchup[]>(`${BASE}/v1/league/${leagueId}/matchups/${week}`, o);
}

export function getTransactions(
  leagueId: string,
  week: number,
  o?: GetOptions,
): Promise<Transaction[]> {
  return getJSON<Transaction[]>(
    `${BASE}/v1/league/${leagueId}/transactions/${week}`,
    o,
  );
}

export function getDraft(draftId: string, o?: GetOptions): Promise<Draft> {
  return getJSON<Draft>(`${BASE}/v1/draft/${draftId}`, o);
}

export function getDraftPicks(draftId: string, o?: GetOptions): Promise<DraftPick[]> {
  return getJSON<DraftPick[]>(`${BASE}/v1/draft/${draftId}/picks`, o);
}

export function getTrendingAdds(
  lookbackHours = 24,
  limit = 50,
  o?: GetOptions,
): Promise<TrendingPlayer[]> {
  return getJSON<TrendingPlayer[]>(
    `${BASE}/v1/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=${limit}`,
    o,
  );
}

/** The ~10MB index. Fetch sparingly — weekly at most — and always trim it. */
export function getRawPlayers(o?: GetOptions): Promise<Record<string, RawPlayer>> {
  return getJSON<Record<string, RawPlayer>>(`${BASE}/v1/players/nfl`, {
    timeoutMs: 90_000,
    ...o,
  });
}

/**
 * Drop ~95% of the payload. Keeps only fantasy-relevant players and only the
 * fields any screen actually renders, so the result fits comfortably in
 * IndexedDB and ships as a static asset.
 */
export function trimPlayerIndex(raw: Record<string, RawPlayer>): PlayerIndex {
  const out: PlayerIndex = {};
  const wanted = new Set<string>(FANTASY_POSITIONS);

  for (const [id, p] of Object.entries(raw)) {
    const pos = p.position ?? p.fantasy_positions?.[0] ?? null;
    if (!pos || !wanted.has(pos)) continue;

    // Team defenses have no name fields; their player_id is the team code.
    const name =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ").trim();

    out[id] = {
      id,
      name: name || id,
      pos,
      team: p.team ?? null,
      injury: p.injury_status ?? null,
      number: p.number ?? null,
      depthOrder: p.depth_chart_order ?? null,
      rank: p.search_rank ?? null,
    };
  }
  return out;
}

/**
 * Projections for a week, keyed by player_id.
 *
 * Gotcha (spec §3): repeated `position[]=` params work from a browser but get
 * mangled by some proxies, which silently return a single position. If the
 * combined call comes back suspiciously narrow, fall back to one request per
 * position and merge.
 */
export async function getProjections(
  season: string,
  week: number,
  o?: GetOptions,
): Promise<Record<string, Projection>> {
  const url = (positions: readonly string[]) =>
    `${BASE}/projections/nfl/${season}/${week}?season_type=regular&` +
    positions.map((p) => `position[]=${p}`).join("&");

  const merge = (rows: Projection[], into: Record<string, Projection>) => {
    for (const row of rows) {
      if (row?.player_id) into[row.player_id] = row;
    }
    return into;
  };

  const combined = await getJSON<Projection[]>(url(FANTASY_POSITIONS), o);
  const byPosition = new Set(
    combined.map((r) => r.player?.position).filter(Boolean) as string[],
  );

  // A healthy combined response spans several positions. One position back
  // means the query array was flattened en route.
  if (combined.length > 0 && byPosition.size <= 1) {
    const out: Record<string, Projection> = {};
    for (const pos of FANTASY_POSITIONS) {
      merge(await getJSON<Projection[]>(url([pos]), o), out);
    }
    return out;
  }

  return merge(combined, {});
}
