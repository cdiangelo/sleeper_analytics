/**
 * League-scored projections.
 *
 * The differentiator over Sleeper's own numbers: never show the default
 * half-PPR figure, always recompute the stat line against THIS league's
 * scoring_settings. Weights are read live from the league endpoint — they are
 * never hardcoded — and checked against the expected table so a settings
 * change surfaces as a warning instead of silently rewriting the app.
 */

import { EXPECTED_SCORING } from "./constants.js";
import type { ScoringSettings } from "./types.js";

/**
 * Score a stat line under a scoring table.
 *
 * Any stat key with a matching numeric weight contributes. Sleeper emits stat
 * keys the league does not score (and scoring keys the player did not record);
 * both are simply absent from the product.
 */
export function leaguePoints(
  stats: Record<string, number> | null | undefined,
  scoringSettings: ScoringSettings,
): number {
  if (!stats) return 0;
  let pts = 0;
  for (const [k, v] of Object.entries(stats)) {
    const w = scoringSettings[k];
    if (typeof v === "number" && typeof w === "number") pts += v * w;
  }
  return pts;
}

/** Per-stat breakdown, for showing why a projection landed where it did. */
export interface ScoringContribution {
  stat: string;
  value: number;
  weight: number;
  points: number;
}

export function scoringBreakdown(
  stats: Record<string, number> | null | undefined,
  scoringSettings: ScoringSettings,
): ScoringContribution[] {
  if (!stats) return [];
  const rows: ScoringContribution[] = [];
  for (const [stat, value] of Object.entries(stats)) {
    const weight = scoringSettings[stat];
    if (typeof value !== "number" || typeof weight !== "number") continue;
    if (value === 0 || weight === 0) continue;
    rows.push({ stat, value, weight, points: value * weight });
  }
  return rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

export interface ScoringMismatch {
  key: string;
  expected: number;
  actual: number | undefined;
}

/**
 * Assert live scoring matches spec section 4. Returns the diffs rather than
 * throwing — a mismatch is a banner in the UI, not a crash, because the live
 * settings always win the math.
 */
export function verifyScoring(live: ScoringSettings): ScoringMismatch[] {
  const out: ScoringMismatch[] = [];
  for (const [key, expected] of Object.entries(EXPECTED_SCORING)) {
    const actual = live[key];
    // Float compare: Sleeper stores 0.1 and 0.04 as floats.
    if (typeof actual !== "number" || Math.abs(actual - expected) > 1e-9) {
      out.push({ key, expected, actual });
    }
  }
  return out;
}

/**
 * Generic half-PPR, for measuring how far this league's scoring diverges.
 *
 * Deliberately covers only offensive skill stats. Kicking and defensive
 * scoring have no "generic half PPR" equivalent to compare against, so an
 * edge computed for a K or DEF would just be their whole score — see
 * `EDGE_COMPARABLE`.
 */
export const HALF_PPR_BASELINE: ScoringSettings = {
  rec: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  rush_yd: 0.1,
  rush_td: 6,
  fum_lost: -2,
};

/** Positions the half-PPR baseline actually scores. */
export const EDGE_COMPARABLE = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Points this league's scoring adds over generic half PPR for a stat line.
 * Positive means the default number understates the player here — the
 * big-play effect of our 40+ yard and yardage bonuses.
 *
 * Returns null for positions the baseline does not cover, where the
 * difference would be the player's entire score rather than an edge.
 */
export function scoringEdge(
  stats: Record<string, number> | null | undefined,
  scoringSettings: ScoringSettings,
  position?: string | null,
): number | null {
  if (position != null && !EDGE_COMPARABLE.has(position)) return null;
  return leaguePoints(stats, scoringSettings) - leaguePoints(stats, HALF_PPR_BASELINE);
}
