import { describe, expect, it } from "vitest";

import {
  playerActuals,
  playerSeries,
  populatedWeeks,
  seriesMax,
} from "../src/lib/series.js";
import type { Matchup } from "../src/lib/types.js";

function row(partial: Partial<Matchup> & { roster_id: number }): Matchup {
  return {
    matchup_id: 1,
    points: 0,
    custom_points: null,
    starters: null,
    starters_points: null,
    players: null,
    players_points: null,
    ...partial,
  };
}

/** Two played weeks plus a populated-but-unplayed week 3. */
const MATCHUPS: Record<number, Matchup[]> = {
  1: [
    row({ roster_id: 5, points: 100, players_points: { henry: 18.4, bench1: 22.1 } }),
    row({ roster_id: 6, points: 90, players_points: { other: 12 } }),
  ],
  2: [
    row({ roster_id: 5, points: 88, players_points: { henry: 9.2, bench1: 4 } }),
    row({ roster_id: 6, points: 95, players_points: { other: 15 } }),
  ],
  3: [
    row({ roster_id: 5, points: 0, players_points: { henry: 0, bench1: 0 } }),
    row({ roster_id: 6, points: 0, players_points: { other: 0 } }),
  ],
};

describe("playerActuals", () => {
  it("reads a player's score from whichever team's row holds them", () => {
    expect([...playerActuals(MATCHUPS, "henry")]).toEqual([
      [1, 18.4],
      [2, 9.2],
    ]);
  });

  it("covers benched players, not just starters", () => {
    // players_points spans the whole roster, which is the point: a bench score
    // is exactly what "should I have started them" needs.
    expect(playerActuals(MATCHUPS, "bench1").get(1)).toBe(22.1);
  });

  it("does not treat an unplayed week's zeros as a score of zero", () => {
    expect(playerActuals(MATCHUPS, "henry").has(3)).toBe(false);
  });

  it("returns nothing for a player on no roster", () => {
    expect(playerActuals(MATCHUPS, "nobody").size).toBe(0);
  });
});

describe("playerSeries", () => {
  const noProjection = () => null;

  it("fills every week of the season, null where nothing is known", () => {
    const s = playerSeries("henry", MATCHUPS, noProjection);
    expect(s.points).toHaveLength(17);
    expect(s.points[0]).toEqual({ week: 1, actual: 18.4, projected: null });
    expect(s.points[2]).toEqual({ week: 3, actual: null, projected: null });
  });

  it("drops the projection for a week that has been played", () => {
    // A played week has a real number; showing a forecast beside it is clutter.
    const s = playerSeries("henry", MATCHUPS, () => 14);
    expect(s.points[0]).toEqual({ week: 1, actual: 18.4, projected: null });
    expect(s.points[2]).toEqual({ week: 3, actual: null, projected: 14 });
  });

  it("totals only what was actually scored", () => {
    const s = playerSeries("henry", MATCHUPS, () => 99);
    expect(s.totalActual).toBeCloseTo(27.6, 10);
    expect(s.bestWeek).toBe(18.4);
  });

  it("reports no best week before anything is played", () => {
    const s = playerSeries("henry", {}, noProjection);
    expect(s.bestWeek).toBeNull();
    expect(s.totalActual).toBe(0);
  });

  it("carries the starting flag through", () => {
    expect(playerSeries("henry", MATCHUPS, noProjection, { starting: true }).starting).toBe(
      true,
    );
  });
});

describe("seriesMax", () => {
  it("spans actual and projected across every series", () => {
    const all = [
      playerSeries("henry", MATCHUPS, () => 5),
      playerSeries("bench1", MATCHUPS, () => 40),
    ];
    expect(seriesMax(all)).toBe(40);
  });

  it("is zero when there is nothing to plot", () => {
    expect(seriesMax([playerSeries("nobody", {}, () => null)])).toBe(0);
  });
});

describe("populatedWeeks", () => {
  it("stops at the last week carrying data", () => {
    // Otherwise an all-null tail squashes the season into the left third.
    const all = [playerSeries("henry", MATCHUPS, () => null)];
    expect(populatedWeeks(all)).toBe(4); // minimum floor, data ends at week 2
  });

  it("extends to the furthest projected week", () => {
    const all = [playerSeries("henry", MATCHUPS, (week) => (week <= 9 ? 10 : null))];
    expect(populatedWeeks(all)).toBe(9);
  });

  it("never returns less than the floor", () => {
    expect(populatedWeeks([playerSeries("nobody", {}, () => null)])).toBe(4);
  });
});
