/**
 * Performance metrics. Everything here is a pure function over matchup rows so
 * it can be unit tested without touching the network — which is the whole
 * point, because all-play and optimal-lineup are where the bugs live.
 */

import { FLEX_ELIGIBLE, STARTER_SLOTS } from "./constants.js";
import type { Matchup } from "./types.js";

/** Resolves a player_id to its position. Backed by the player index. */
export type PositionLookup = (playerId: string) => string | null;

// --- week selection ---------------------------------------------------------

/**
 * A week counts as played once any team has scored. Sleeper returns fully
 * formed rows with zeroed points for future weeks, so row presence alone is
 * not evidence of a game.
 */
export function weekHasScores(rows: Matchup[] | undefined): boolean {
  return !!rows?.some((r) => (r.points ?? 0) > 0);
}

export function playedWeeks(matchups: Record<number, Matchup[]>): number[] {
  return Object.keys(matchups)
    .map(Number)
    .filter((w) => weekHasScores(matchups[w]))
    .sort((a, b) => a - b);
}

// --- scores -----------------------------------------------------------------

export interface WeekScore {
  week: number;
  rosterId: number;
  points: number;
  opponentRosterId: number | null;
  opponentPoints: number | null;
  won: boolean | null;
  tied: boolean;
}

/** Pair teams by matchup_id and emit one row per team per week. */
export function weekScores(week: number, rows: Matchup[]): WeekScore[] {
  const byMatchup = new Map<number, Matchup[]>();
  for (const row of rows) {
    if (row.matchup_id == null) continue;
    const list = byMatchup.get(row.matchup_id) ?? [];
    list.push(row);
    byMatchup.set(row.matchup_id, list);
  }

  const out: WeekScore[] = [];
  for (const row of rows) {
    const pair = row.matchup_id == null ? [] : (byMatchup.get(row.matchup_id) ?? []);
    const opp = pair.find((r) => r.roster_id !== row.roster_id) ?? null;
    const points = row.points ?? 0;
    const oppPoints = opp ? (opp.points ?? 0) : null;

    out.push({
      week,
      rosterId: row.roster_id,
      points,
      opponentRosterId: opp?.roster_id ?? null,
      opponentPoints: oppPoints,
      won: oppPoints == null ? null : points > oppPoints,
      tied: oppPoints != null && points === oppPoints,
    });
  }
  return out;
}

export interface WeekSummary {
  week: number;
  average: number;
  high: number;
  low: number;
  median: number;
  scores: WeekScore[];
}

export function summarizeWeek(week: number, rows: Matchup[]): WeekSummary {
  const scores = weekScores(week, rows);
  const pts = scores.map((s) => s.points).sort((a, b) => a - b);
  return {
    week,
    average: mean(pts),
    high: pts.at(-1) ?? 0,
    low: pts[0] ?? 0,
    median: percentile(pts, 50),
    scores,
  };
}

/**
 * Weekly score vs league average vs week high — the trend line, three series.
 */
export function trendSeries(
  matchups: Record<number, Matchup[]>,
  rosterId: number,
): Array<{ week: number; points: number; average: number; high: number }> {
  return playedWeeks(matchups).map((week) => {
    const s = summarizeWeek(week, matchups[week]!);
    return {
      week,
      points: s.scores.find((x) => x.rosterId === rosterId)?.points ?? 0,
      average: s.average,
      high: s.high,
    };
  });
}

// --- all-play ---------------------------------------------------------------

export interface Record_ {
  wins: number;
  losses: number;
  ties: number;
}

export interface AllPlayRow {
  rosterId: number;
  /** Score vs every other team, every week. */
  allPlay: Record_;
  allPlayPct: number;
  /** Head-to-head result against the actual scheduled opponent. */
  actual: Record_;
  actualPct: number;
  /**
   * actualPct - allPlayPct. Positive means the schedule has been kind:
   * you are winning more than your scoring deserves.
   */
  luck: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * All-play record: your score against every other team, every week — 9 games a
 * week in a 10-team league instead of 1. The gap between all-play win% and
 * actual win% is the luck number, and it is the single most useful thing in a
 * league this size.
 */
export function allPlayStandings(matchups: Record<number, Matchup[]>): AllPlayRow[] {
  const weeks = playedWeeks(matchups);
  const acc = new Map<number, AllPlayRow>();

  const row = (rosterId: number): AllPlayRow => {
    let r = acc.get(rosterId);
    if (!r) {
      r = {
        rosterId,
        allPlay: { wins: 0, losses: 0, ties: 0 },
        allPlayPct: 0,
        actual: { wins: 0, losses: 0, ties: 0 },
        actualPct: 0,
        luck: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      acc.set(rosterId, r);
    }
    return r;
  };

  for (const week of weeks) {
    const scores = weekScores(week, matchups[week]!);

    for (const me of scores) {
      const r = row(me.rosterId);
      r.pointsFor += me.points;
      r.pointsAgainst += me.opponentPoints ?? 0;

      for (const other of scores) {
        if (other.rosterId === me.rosterId) continue;
        if (me.points > other.points) r.allPlay.wins++;
        else if (me.points < other.points) r.allPlay.losses++;
        else r.allPlay.ties++;
      }

      if (me.won === null) continue;
      if (me.tied) r.actual.ties++;
      else if (me.won) r.actual.wins++;
      else r.actual.losses++;
    }
  }

  const rows = [...acc.values()];
  for (const r of rows) {
    r.allPlayPct = winPct(r.allPlay);
    r.actualPct = winPct(r.actual);
    r.luck = r.actualPct - r.allPlayPct;
  }
  return rows.sort((a, b) => b.allPlayPct - a.allPlayPct || b.pointsFor - a.pointsFor);
}

export function winPct(r: Record_): number {
  const games = r.wins + r.losses + r.ties;
  return games === 0 ? 0 : (r.wins + r.ties * 0.5) / games;
}

// --- optimal lineup ---------------------------------------------------------

export interface LineupSlot {
  slot: string;
  playerId: string | null;
  points: number;
}

export interface OptimalLineup {
  lineup: LineupSlot[];
  points: number;
}

/**
 * Best legal lineup from a set of scored players.
 *
 * Fills dedicated slots first with the highest scorer at each position, then
 * drops the best remaining flex-eligible players into FLEX. Greedy is optimal
 * for this slot structure: FLEX accepts a superset of the dedicated positions,
 * so no dedicated slot ever wants a player that flex has taken.
 */
export function optimalLineup(
  playersPoints: Record<string, number>,
  posOf: PositionLookup,
  slots: readonly string[] = STARTER_SLOTS,
): OptimalLineup {
  const pool = Object.entries(playersPoints)
    .map(([playerId, points]) => ({ playerId, points: points ?? 0, pos: posOf(playerId) }))
    .sort((a, b) => b.points - a.points);

  const used = new Set<string>();
  const lineup: LineupSlot[] = [];

  const take = (eligible: (pos: string | null) => boolean): LineupSlot["playerId"] => {
    const pick = pool.find((p) => !used.has(p.playerId) && eligible(p.pos));
    if (!pick) return null;
    used.add(pick.playerId);
    return pick.playerId;
  };

  // Dedicated slots before FLEX, so flex never steals a starter's only option.
  const ordered = [...slots].sort(
    (a, b) => Number(a === "FLEX") - Number(b === "FLEX"),
  );

  // Queue each slot's picks by name so the result can be re-emitted in the
  // league's declared order regardless of the order they were filled in.
  const queues = new Map<string, LineupSlot[]>();
  for (const slot of ordered) {
    const playerId =
      slot === "FLEX"
        ? take((pos) => !!pos && FLEX_ELIGIBLE.has(pos))
        : take((pos) => pos === slot);

    const entry: LineupSlot = {
      slot,
      playerId,
      points: playerId ? (playersPoints[playerId] ?? 0) : 0,
    };
    const queue = queues.get(slot) ?? [];
    queue.push(entry);
    queues.set(slot, queue);
  }

  for (const slot of slots) {
    const next = queues.get(slot)?.shift();
    if (next) lineup.push(next);
  }

  return { lineup, points: lineup.reduce((sum, s) => sum + s.points, 0) };
}

export interface BenchReport {
  week: number;
  rosterId: number;
  actual: number;
  optimal: number;
  /** Points left on the bench. Never negative. */
  left: number;
  lineup: LineupSlot[];
}

/** What you started vs what you could have started, for one team-week. */
export function benchReport(
  week: number,
  row: Matchup,
  posOf: PositionLookup,
  slots: readonly string[] = STARTER_SLOTS,
): BenchReport {
  const best = optimalLineup(row.players_points ?? {}, posOf, slots);
  const actual = row.points ?? 0;
  return {
    week,
    rosterId: row.roster_id,
    actual,
    optimal: best.points,
    left: Math.max(0, best.points - actual),
    lineup: best.lineup,
  };
}

export function benchReports(
  matchups: Record<number, Matchup[]>,
  rosterId: number,
  posOf: PositionLookup,
  slots: readonly string[] = STARTER_SLOTS,
): BenchReport[] {
  const out: BenchReport[] = [];
  for (const week of playedWeeks(matchups)) {
    const row = matchups[week]!.find((r) => r.roster_id === rosterId);
    if (row) out.push(benchReport(week, row, posOf, slots));
  }
  return out;
}

// --- positional contribution ------------------------------------------------

export interface PositionalShare {
  position: string;
  points: number;
  share: number;
}

/**
 * Share of a team's started points by position. Compared against the league
 * mean, this is what shows whether you are winning at RB or bleeding at TE.
 */
export function positionalContribution(
  row: Matchup,
  posOf: PositionLookup,
): PositionalShare[] {
  const totals = new Map<string, number>();
  const starters = row.starters ?? [];
  const pts = row.starters_points ?? [];

  for (const [i, playerId] of starters.entries()) {
    if (!playerId || playerId === "0") continue;
    const pos = posOf(playerId) ?? "UNK";
    totals.set(pos, (totals.get(pos) ?? 0) + (pts[i] ?? 0));
  }

  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([position, points]) => ({
      position,
      points,
      share: total === 0 ? 0 : points / total,
    }))
    .sort((a, b) => b.points - a.points);
}

export interface PositionalComparison {
  position: string;
  mine: number;
  leagueAverage: number;
  /** Points per week above (positive) or below (negative) the league mean. */
  edge: number;
}

export function positionalEdge(
  matchups: Record<number, Matchup[]>,
  rosterId: number,
  posOf: PositionLookup,
): PositionalComparison[] {
  const weeks = playedWeeks(matchups);
  const mine = new Map<string, number>();
  const league = new Map<string, number>();
  let teamWeeks = 0;

  for (const week of weeks) {
    for (const row of matchups[week]!) {
      teamWeeks++;
      for (const { position, points } of positionalContribution(row, posOf)) {
        league.set(position, (league.get(position) ?? 0) + points);
        if (row.roster_id === rosterId) {
          mine.set(position, (mine.get(position) ?? 0) + points);
        }
      }
    }
  }

  const teams = teamWeeks / Math.max(1, weeks.length);
  const positions = new Set([...mine.keys(), ...league.keys()]);

  return [...positions]
    .map((position) => {
      const minePerWeek = (mine.get(position) ?? 0) / Math.max(1, weeks.length);
      const leagueAverage =
        (league.get(position) ?? 0) / Math.max(1, weeks.length) / Math.max(1, teams);
      return {
        position,
        mine: minePerWeek,
        leagueAverage,
        edge: minePerWeek - leagueAverage,
      };
    })
    .sort((a, b) => b.edge - a.edge);
}

// --- consistency and schedule -----------------------------------------------

export interface Consistency {
  weeks: number;
  mean: number;
  stdev: number;
  /** 20th percentile — the bad-week floor. */
  floor: number;
  /** 80th percentile — the realistic ceiling. */
  ceiling: number;
  min: number;
  max: number;
}

export function consistency(scores: number[]): Consistency {
  const sorted = [...scores].sort((a, b) => a - b);
  const m = mean(sorted);
  return {
    weeks: scores.length,
    mean: m,
    stdev: stdev(scores, m),
    floor: percentile(sorted, 20),
    ceiling: percentile(sorted, 80),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

export interface OpponentStrength {
  week: number;
  opponentRosterId: number | null;
  opponentPoints: number;
  /** 1 = your opponent was the week's highest scorer league-wide. */
  rankLeagueWide: number;
  teams: number;
}

/**
 * How hard your schedule has actually been: where each opponent's score landed
 * against the whole league that week.
 */
export function opponentStrength(
  matchups: Record<number, Matchup[]>,
  rosterId: number,
): OpponentStrength[] {
  return playedWeeks(matchups).map((week) => {
    const rows = matchups[week]!;
    const scores = weekScores(week, rows);
    const me = scores.find((s) => s.rosterId === rosterId);
    const oppPoints = me?.opponentPoints ?? 0;
    const ranked = [...scores].sort((a, b) => b.points - a.points);

    return {
      week,
      opponentRosterId: me?.opponentRosterId ?? null,
      opponentPoints: oppPoints,
      rankLeagueWide: ranked.findIndex((s) => s.rosterId === me?.opponentRosterId) + 1,
      teams: scores.length,
    };
  });
}

// --- math -------------------------------------------------------------------

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Linear-interpolated percentile over an ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = ((sortedAsc.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (idx - lo);
}
