/**
 * "Better than what?" — the question a waiver list leaves unanswered.
 *
 * A ranked free agent only matters relative to the player who would come off
 * the roster for him. This pairs a target with the people he would actually
 * replace, and states the difference in points.
 */

export interface ProjectionLookup {
  /** League-scored projection for a week, or null where none has published. */
  (week: number, playerId: string): number | null;
}

export interface PlayerValue {
  /** Projection for the coming week. */
  thisWeek: number | null;
  /** Mean projection per week across the rest of the season. */
  restOfSeason: number | null;
  /** How many future weeks that mean is built from. */
  weeks: number;
}

/**
 * Value a player carries from here to the end of the season.
 *
 * Rest-of-season is the number that should drive a waiver claim: a one-week
 * spike is a streaming decision, but a roster spot is held for months. Weeks
 * with no projection are skipped rather than counted as zero, so a bye does
 * not quietly depress the average.
 */
export function playerValue(
  playerId: string,
  fromWeek: number,
  projectedAt: ProjectionLookup,
  lastWeek = 17,
): PlayerValue {
  const future: number[] = [];
  for (let week = fromWeek; week <= lastWeek; week++) {
    const points = projectedAt(week, playerId);
    if (points != null) future.push(points);
  }

  return {
    thisWeek: projectedAt(fromWeek, playerId),
    restOfSeason:
      future.length > 0 ? future.reduce((a, b) => a + b, 0) / future.length : null,
    weeks: future.length,
  };
}

export interface ReplacementCandidate {
  playerId: string;
  starting: boolean;
  value: PlayerValue;
  /** Target minus candidate for the coming week. */
  deltaThisWeek: number | null;
  /** Target minus candidate, per week, across the rest of the season. */
  deltaRestOfSeason: number | null;
}

export interface UpgradeComparison {
  targetId: string;
  target: PlayerValue;
  candidates: ReplacementCandidate[];
  /** True when the roster carries nobody at this position at all. */
  openSlot: boolean;
}

/**
 * The players a target would displace: your own, at the same position,
 * weakest first, because the weakest is who actually gets dropped.
 *
 * Starters are included rather than filtered out — if a free agent beats
 * someone you are starting, that is the most important row on the screen, and
 * hiding it to show three bench players would be the wrong answer.
 */
export function compareToRoster(
  targetId: string,
  position: string,
  rosterIds: readonly string[],
  positionOf: (playerId: string) => string | null,
  starters: ReadonlySet<string>,
  fromWeek: number,
  projectedAt: ProjectionLookup,
  limit = 3,
): UpgradeComparison {
  const target = playerValue(targetId, fromWeek, projectedAt);

  const mine = rosterIds
    .filter((id) => id !== targetId && positionOf(id) === position)
    .map((id) => ({ playerId: id, value: playerValue(id, fromWeek, projectedAt) }));

  const rank = (v: PlayerValue) => v.restOfSeason ?? v.thisWeek ?? -Infinity;

  const candidates = mine
    .sort((a, b) => rank(a.value) - rank(b.value))
    .slice(0, limit)
    .map(
      ({ playerId, value }): ReplacementCandidate => ({
        playerId,
        starting: starters.has(playerId),
        value,
        deltaThisWeek:
          target.thisWeek != null && value.thisWeek != null
            ? target.thisWeek - value.thisWeek
            : null,
        deltaRestOfSeason:
          target.restOfSeason != null && value.restOfSeason != null
            ? target.restOfSeason - value.restOfSeason
            : null,
      }),
    );

  return { targetId, target, candidates, openSlot: mine.length === 0 };
}

/** One-line verdict, so the numbers do not have to be interpreted. */
export function describeUpgrade(comparison: UpgradeComparison): string {
  if (comparison.openSlot) return "No one at this position — pure addition";

  const best = comparison.candidates[0];
  if (!best || best.deltaRestOfSeason == null) return "Not enough projection to compare";

  const gain = best.deltaRestOfSeason;
  if (gain <= 0) return "Downgrade on everyone you would drop";
  if (best.starting) return `Upgrades a starter by ${gain.toFixed(1)} a week`;
  return `Worth ${gain.toFixed(1)} a week over your weakest`;
}
