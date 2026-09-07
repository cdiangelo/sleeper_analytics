import { describe, expect, it } from "vitest";

import {
  allPlayStandings,
  benchReport,
  consistency,
  optimalLineup,
  opponentStrength,
  percentile,
  playedWeeks,
  positionalContribution,
  trendSeries,
  weekScores,
} from "../src/lib/metrics.js";
import type { Matchup } from "../src/lib/types.js";

/** Build a matchup row with only the fields the metric under test reads. */
function row(partial: Partial<Matchup> & { roster_id: number }): Matchup {
  return {
    matchup_id: null,
    points: 0,
    custom_points: null,
    starters: null,
    starters_points: null,
    players: null,
    players_points: null,
    ...partial,
  };
}

/**
 * Four teams, two weeks, scores chosen so all-play and actual records diverge
 * in both directions. Every expectation below is hand-computed.
 *
 * Week 1  A 100 vs B 90   |  C 80 vs D 70
 * Week 2  A  60 vs B 110  |  C 95 vs D 105
 */
const FIXTURE: Record<number, Matchup[]> = {
  1: [
    row({ roster_id: 1, matchup_id: 1, points: 100 }),
    row({ roster_id: 2, matchup_id: 1, points: 90 }),
    row({ roster_id: 3, matchup_id: 2, points: 80 }),
    row({ roster_id: 4, matchup_id: 2, points: 70 }),
  ],
  2: [
    row({ roster_id: 1, matchup_id: 1, points: 60 }),
    row({ roster_id: 2, matchup_id: 1, points: 110 }),
    row({ roster_id: 3, matchup_id: 2, points: 95 }),
    row({ roster_id: 4, matchup_id: 2, points: 105 }),
  ],
};

describe("playedWeeks", () => {
  it("treats an all-zero week as not yet played", () => {
    const preseason = {
      1: [row({ roster_id: 1, matchup_id: 1, points: 0 }), row({ roster_id: 2, matchup_id: 1, points: 0 })],
    };
    expect(playedWeeks(preseason)).toEqual([]);
  });

  it("returns played weeks in ascending order", () => {
    expect(playedWeeks(FIXTURE)).toEqual([1, 2]);
  });
});

describe("weekScores", () => {
  it("pairs opponents by matchup_id and marks the winner", () => {
    const scores = weekScores(1, FIXTURE[1]!);
    const a = scores.find((s) => s.rosterId === 1)!;
    expect(a.opponentRosterId).toBe(2);
    expect(a.opponentPoints).toBe(90);
    expect(a.won).toBe(true);
    expect(a.tied).toBe(false);

    const d = scores.find((s) => s.rosterId === 4)!;
    expect(d.won).toBe(false);
  });

  it("marks a tie as tied rather than won", () => {
    const tied = weekScores(1, [
      row({ roster_id: 1, matchup_id: 1, points: 88 }),
      row({ roster_id: 2, matchup_id: 1, points: 88 }),
    ]);
    expect(tied[0]!.tied).toBe(true);
    expect(tied[0]!.won).toBe(false);
  });

  it("leaves a bye week without an opponent", () => {
    const bye = weekScores(1, [row({ roster_id: 1, matchup_id: null, points: 88 })]);
    expect(bye[0]!.opponentRosterId).toBeNull();
    expect(bye[0]!.won).toBeNull();
  });
});

describe("allPlayStandings", () => {
  const table = allPlayStandings(FIXTURE);
  const byRoster = (id: number) => table.find((r) => r.rosterId === id)!;

  it("scores every team against every other team each week", () => {
    // A: 3-0 in week 1 (high score), 0-3 in week 2 (low score).
    expect(byRoster(1).allPlay).toEqual({ wins: 3, losses: 3, ties: 0 });
    // B: 2-1 then 3-0.
    expect(byRoster(2).allPlay).toEqual({ wins: 5, losses: 1, ties: 0 });
    expect(byRoster(3).allPlay).toEqual({ wins: 2, losses: 4, ties: 0 });
    expect(byRoster(4).allPlay).toEqual({ wins: 2, losses: 4, ties: 0 });
  });

  it("tracks head-to-head separately — everyone here is 1-1", () => {
    for (const id of [1, 2, 3, 4]) {
      expect(byRoster(id).actual).toEqual({ wins: 1, losses: 1, ties: 0 });
    }
  });

  it("computes luck as actual minus all-play win rate", () => {
    // B scores like a 5-1 team and has a 1-1 record: the schedule robbed it.
    expect(byRoster(2).luck).toBeCloseTo(0.5 - 5 / 6, 10);
    // C and D score like 2-4 teams and sit at 1-1: schedule-carried.
    expect(byRoster(3).luck).toBeCloseTo(0.5 - 2 / 6, 10);
    // A's record matches its scoring exactly.
    expect(byRoster(1).luck).toBeCloseTo(0, 10);
  });

  it("accumulates points for and against", () => {
    expect(byRoster(1).pointsFor).toBe(160);
    expect(byRoster(1).pointsAgainst).toBe(200);
    expect(byRoster(2).pointsFor).toBe(200);
    expect(byRoster(2).pointsAgainst).toBe(160);
  });

  it("ranks by all-play win rate", () => {
    expect(table.map((r) => r.rosterId)).toEqual([2, 1, 3, 4]);
  });
});

describe("optimalLineup", () => {
  const positions: Record<string, string> = {
    qb1: "QB",
    rb1: "RB",
    rb2: "RB",
    wr1: "WR",
    wr2: "WR",
    te1: "TE",
  };
  const posOf = (id: string) => positions[id] ?? null;
  const SLOTS = ["QB", "RB", "WR", "TE", "FLEX"] as const;

  it("fills dedicated slots before FLEX so a scarce position is not stolen", () => {
    // te1 is the highest scorer on the roster and the ONLY tight end. Filling
    // FLEX first would strand the TE slot at zero for a net loss of 13.
    const points = { qb1: 20, rb1: 15, rb2: 8, wr1: 18, wr2: 12, te1: 25 };
    const best = optimalLineup(points, posOf, SLOTS);

    expect(best.points).toBe(90); // 20 + 15 + 18 + 25 + 12
    expect(best.lineup.find((s) => s.slot === "TE")!.playerId).toBe("te1");
    expect(best.lineup.find((s) => s.slot === "FLEX")!.playerId).toBe("wr2");
  });

  it("puts the best remaining flex-eligible player in FLEX", () => {
    const points = { qb1: 20, rb1: 15, rb2: 14, wr1: 18, wr2: 9, te1: 5 };
    const best = optimalLineup(points, posOf, SLOTS);
    // Remaining after QB/RB/WR/TE: rb2 (14) and wr2 (9). FLEX takes rb2.
    expect(best.lineup.find((s) => s.slot === "FLEX")!.playerId).toBe("rb2");
    expect(best.points).toBe(72);
  });

  it("never starts the same player twice", () => {
    const points = { qb1: 20, rb1: 15, wr1: 18, te1: 5 };
    const best = optimalLineup(points, posOf, SLOTS);
    const ids = best.lineup.map((s) => s.playerId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves a slot empty when no eligible player exists", () => {
    const best = optimalLineup({ qb1: 20 }, posOf, SLOTS);
    expect(best.lineup.find((s) => s.slot === "RB")!.playerId).toBeNull();
    expect(best.points).toBe(20);
  });

  it("emits slots in the league's declared order", () => {
    const points = { qb1: 20, rb1: 15, rb2: 8, wr1: 18, wr2: 12, te1: 5 };
    const best = optimalLineup(points, posOf, ["QB", "RB", "RB", "WR", "FLEX"]);
    expect(best.lineup.map((s) => s.slot)).toEqual(["QB", "RB", "RB", "WR", "FLEX"]);
  });

  it("ignores unknown players rather than treating them as flex-eligible", () => {
    const points = { qb1: 20, mystery: 99 };
    const best = optimalLineup(points, posOf, SLOTS);
    expect(best.points).toBe(20);
  });
});

describe("benchReport", () => {
  const positions: Record<string, string> = { qb1: "QB", rb1: "RB", rb2: "RB" };
  const posOf = (id: string) => positions[id] ?? null;

  it("reports the gap between what was started and the best legal lineup", () => {
    const report = benchReport(
      3,
      row({
        roster_id: 5,
        points: 25, // started qb1 (20) and rb2 (5)
        players_points: { qb1: 20, rb1: 30, rb2: 5 },
      }),
      posOf,
      ["QB", "RB"],
    );
    expect(report.optimal).toBe(50); // qb1 + rb1
    expect(report.actual).toBe(25);
    expect(report.left).toBe(25);
  });

  it("never reports negative points left when the lineup was optimal", () => {
    const report = benchReport(
      3,
      row({ roster_id: 5, points: 50, players_points: { qb1: 20, rb1: 30 } }),
      posOf,
      ["QB", "RB"],
    );
    expect(report.left).toBe(0);
  });
});

describe("positionalContribution", () => {
  it("sums started points by position and shares them", () => {
    const posOf = (id: string) =>
      ({ qb1: "QB", rb1: "RB", rb2: "RB" })[id] ?? null;
    const shares = positionalContribution(
      row({
        roster_id: 5,
        starters: ["qb1", "rb1", "rb2"],
        starters_points: [20, 20, 10],
      }),
      posOf,
    );
    const rb = shares.find((s) => s.position === "RB")!;
    expect(rb.points).toBe(30);
    expect(rb.share).toBeCloseTo(0.6, 10);
  });

  it("skips empty starter slots", () => {
    const shares = positionalContribution(
      row({ roster_id: 5, starters: ["0", ""], starters_points: [0, 0] }),
      () => "QB",
    );
    expect(shares).toEqual([]);
  });
});

describe("opponentStrength", () => {
  it("ranks each opponent's score against the whole league that week", () => {
    const strength = opponentStrength(FIXTURE, 1);
    // Week 1: A played B (90), the second-highest score of four.
    expect(strength[0]).toMatchObject({ week: 1, opponentPoints: 90, rankLeagueWide: 2 });
    // Week 2: A played B (110), the week's highest.
    expect(strength[1]).toMatchObject({ week: 2, opponentPoints: 110, rankLeagueWide: 1 });
  });
});

describe("trendSeries", () => {
  it("returns the team score, league average and week high per week", () => {
    const series = trendSeries(FIXTURE, 1);
    expect(series[0]).toEqual({ week: 1, points: 100, average: 85, high: 100 });
    expect(series[1]).toEqual({ week: 2, points: 60, average: 92.5, high: 110 });
  });
});

describe("consistency", () => {
  it("summarizes a score distribution", () => {
    const c = consistency([100, 90, 80, 70]);
    expect(c.weeks).toBe(4);
    expect(c.mean).toBe(85);
    expect(c.min).toBe(70);
    expect(c.max).toBe(100);
    // Sample stdev of 70/80/90/100.
    expect(c.stdev).toBeCloseTo(12.909944, 5);
  });

  it("reports zero spread for a single week", () => {
    expect(consistency([100]).stdev).toBe(0);
  });

  it("handles no weeks played", () => {
    const c = consistency([]);
    expect(c).toMatchObject({ weeks: 0, mean: 0, stdev: 0, min: 0, max: 0 });
  });
});

describe("percentile", () => {
  it("interpolates between neighbours", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
  });

  it("returns zero for an empty set", () => {
    expect(percentile([], 50)).toBe(0);
  });
});
