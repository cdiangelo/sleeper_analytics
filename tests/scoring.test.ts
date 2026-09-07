import { describe, expect, it } from "vitest";

import { EXPECTED_SCORING } from "../src/lib/constants.js";
import {
  HALF_PPR_BASELINE,
  leaguePoints,
  scoringBreakdown,
  scoringEdge,
  verifyScoring,
} from "../src/lib/scoring.js";

describe("leaguePoints", () => {
  it("scores a receiving line under league settings including bonuses", () => {
    // 8 catches, 124 yards, 1 TD, one 40+ reception, crosses the 100-yard bonus.
    const stats = {
      rec: 8,
      rec_yd: 124,
      rec_td: 1,
      rec_40p: 1,
      bonus_rec_yd_100: 1,
    };
    // 4 + 12.4 + 6 + 1 + 2
    expect(leaguePoints(stats, EXPECTED_SCORING)).toBeCloseTo(25.4, 10);
  });

  it("scores a passing line with interceptions and the 300-yard bonus", () => {
    const stats = { pass_yd: 312, pass_td: 2, pass_int: 1, bonus_pass_yd_300: 1 };
    // 12.48 + 8 - 1 + 1
    expect(leaguePoints(stats, EXPECTED_SCORING)).toBeCloseTo(20.48, 10);
  });

  it("scores a defense including the points-allowed bucket", () => {
    const stats = { pts_allow_7_13: 1, sack: 4, int: 2, ff: 1, def_td: 1 };
    // 4 + 4 + 4 + 1 + 6
    expect(leaguePoints(stats, EXPECTED_SCORING)).toBeCloseTo(19, 10);
  });

  it("ignores stats the league does not score", () => {
    const stats = { rec: 5, gp: 1, off_snp: 62, anytime_tds: 1 };
    expect(leaguePoints(stats, EXPECTED_SCORING)).toBeCloseTo(2.5, 10);
  });

  it("ignores scoring keys the player did not record", () => {
    expect(leaguePoints({ rec: 2 }, EXPECTED_SCORING)).toBeCloseTo(1, 10);
  });

  it("returns zero for a missing stat line", () => {
    expect(leaguePoints(null, EXPECTED_SCORING)).toBe(0);
    expect(leaguePoints(undefined, EXPECTED_SCORING)).toBe(0);
    expect(leaguePoints({}, EXPECTED_SCORING)).toBe(0);
  });

  it("skips non-numeric values rather than producing NaN", () => {
    const stats = { rec: 3, team: "SF" } as unknown as Record<string, number>;
    expect(leaguePoints(stats, EXPECTED_SCORING)).toBeCloseTo(1.5, 10);
  });

  it("uses the settings passed in, never a hardcoded table", () => {
    // Full PPR instead of the league's half.
    expect(leaguePoints({ rec: 6 }, { rec: 1 })).toBe(6);
    expect(leaguePoints({ rec: 6 }, {})).toBe(0);
  });
});

describe("verifyScoring", () => {
  it("passes when live settings match the spec", () => {
    expect(verifyScoring(EXPECTED_SCORING)).toEqual([]);
  });

  it("tolerates float representation of fractional weights", () => {
    expect(verifyScoring({ ...EXPECTED_SCORING, rec_yd: 0.1 + 1e-12 })).toEqual([]);
  });

  it("reports a changed weight", () => {
    const diffs = verifyScoring({ ...EXPECTED_SCORING, rec: 1 });
    expect(diffs).toEqual([{ key: "rec", expected: 0.5, actual: 1 }]);
  });

  it("reports a missing weight", () => {
    const live = { ...EXPECTED_SCORING };
    delete live.bonus_rec_yd_100;
    expect(verifyScoring(live)).toEqual([
      { key: "bonus_rec_yd_100", expected: 2, actual: undefined },
    ]);
  });
});

describe("scoringEdge", () => {
  it("is positive for a big-play line this league rewards beyond half PPR", () => {
    // Two 40+ catches and a 100-yard game: worth 4 more than generic half PPR.
    const stats = { rec: 5, rec_yd: 142, rec_td: 1, rec_40p: 2, bonus_rec_yd_100: 1 };
    expect(scoringEdge(stats, EXPECTED_SCORING)).toBeCloseTo(4, 10);
  });

  it("is zero for a volume line with no bonuses", () => {
    const stats = { rec: 9, rec_yd: 74, rec_td: 0 };
    expect(scoringEdge(stats, EXPECTED_SCORING)).toBeCloseTo(0, 10);
  });

  it("baseline is plain half PPR", () => {
    expect(HALF_PPR_BASELINE.rec).toBe(0.5);
    expect(HALF_PPR_BASELINE.bonus_rec_yd_100).toBeUndefined();
  });
});

describe("scoringBreakdown", () => {
  it("orders contributions by absolute impact", () => {
    const rows = scoringBreakdown(
      { rec: 8, rec_yd: 124, rec_td: 1, pass_int: 1 },
      EXPECTED_SCORING,
    );
    expect(rows.map((r) => r.stat)).toEqual(["rec_yd", "rec_td", "rec", "pass_int"]);
    expect(rows[0]).toMatchObject({ stat: "rec_yd", value: 124, weight: 0.1 });
    expect(rows[0]!.points).toBeCloseTo(12.4, 10);
  });

  it("omits stats that contribute nothing", () => {
    const rows = scoringBreakdown({ rec: 0, rec_yd: 40 }, EXPECTED_SCORING);
    expect(rows.map((r) => r.stat)).toEqual(["rec_yd"]);
  });
});

describe("scoringEdge position coverage", () => {
  it("has no meaning for kickers, whose stats half PPR does not score", () => {
    // Without this guard a kicker's whole score reads as bonus scoring.
    const stats = { fgm_30_39: 2, xpm: 3, fgm_40_49: 1 };
    expect(scoringEdge(stats, EXPECTED_SCORING, "K")).toBeNull();
    expect(scoringEdge(stats, EXPECTED_SCORING, "DEF")).toBeNull();
  });

  it("still scores skill positions", () => {
    const stats = { rec: 4, rec_yd: 110, rec_40p: 1, bonus_rec_yd_100: 1 };
    expect(scoringEdge(stats, EXPECTED_SCORING, "WR")).toBeCloseTo(3, 10);
  });

  it("computes an edge when no position is supplied", () => {
    expect(scoringEdge({ rec_40p: 1 }, EXPECTED_SCORING)).toBeCloseTo(1, 10);
  });
});
