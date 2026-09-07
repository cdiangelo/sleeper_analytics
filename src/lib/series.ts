/**
 * Per-player weekly series: what they actually scored, and what they are
 * projected to score.
 *
 * Pure functions over already-fetched data, so the charts can be tested
 * without a browser or a network.
 */

import { weekHasScores } from "./metrics.js";
import type { Matchup } from "./types.js";

/** Fantasy regular season plus playoffs. */
export const SEASON_WEEKS = 17;

export interface SeriesPoint {
  week: number;
  /** Points scored. Null for a week not yet played. */
  actual: number | null;
  /** League-scored projection. Null where none has published. */
  projected: number | null;
}

export interface PlayerSeries {
  playerId: string;
  points: SeriesPoint[];
  /** True when the player was in the starting lineup most recently. */
  starting: boolean;
  totalActual: number;
  bestWeek: number | null;
}

/**
 * Points a player scored each week, from every team's matchup rows.
 *
 * `players_points` covers a team's whole roster, not just its starters, so a
 * player who was benched still has a score — which is the entire point of
 * showing this next to the lineup.
 */
export function playerActuals(
  matchups: Record<number, Matchup[]>,
  playerId: string,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, rows] of Object.entries(matchups)) {
    const week = Number(key);
    // A week Sleeper has populated but nobody has played is not a zero score.
    if (!weekHasScores(rows)) continue;
    for (const row of rows) {
      const points = row.players_points?.[playerId];
      if (typeof points === "number") {
        out.set(week, points);
        break;
      }
    }
  }
  return out;
}

/**
 * Build one player's full-season line.
 *
 * `projectedAt` resolves a league-scored projection for a week, returning null
 * where projections have not published — which, for weeks beyond the loaded
 * horizon, is most of them.
 */
export function playerSeries(
  playerId: string,
  matchups: Record<number, Matchup[]>,
  projectedAt: (week: number, playerId: string) => number | null,
  opts: { starting?: boolean; weeks?: number } = {},
): PlayerSeries {
  const actuals = playerActuals(matchups, playerId);
  const weeks = opts.weeks ?? SEASON_WEEKS;
  const points: SeriesPoint[] = [];

  for (let week = 1; week <= weeks; week++) {
    const actual = actuals.get(week) ?? null;
    points.push({
      week,
      actual,
      // Once a week is played its actual is the truth; a projection alongside
      // it would just be clutter on the line.
      projected: actual == null ? projectedAt(week, playerId) : null,
    });
  }

  const scored = [...actuals.values()];
  return {
    playerId,
    points,
    starting: opts.starting ?? false,
    totalActual: scored.reduce((a, b) => a + b, 0),
    bestWeek: scored.length ? Math.max(...scored) : null,
  };
}

/** Highest value anywhere in a set of series, for a shared y scale. */
export function seriesMax(all: PlayerSeries[]): number {
  let max = 0;
  for (const s of all) {
    for (const p of s.points) {
      if (p.actual != null && p.actual > max) max = p.actual;
      if (p.projected != null && p.projected > max) max = p.projected;
    }
  }
  return max;
}

/**
 * The weeks worth drawing: through the last week carrying any data, so an
 * all-null tail does not squash the season into the left third of the chart.
 */
export function populatedWeeks(all: PlayerSeries[], minimum = 4): number {
  let last = 0;
  for (const s of all) {
    for (const p of s.points) {
      if (p.actual != null || p.projected != null) last = Math.max(last, p.week);
    }
  }
  return Math.max(minimum, last);
}
