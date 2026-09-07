import { describe, expect, it } from "vitest";

import {
  compareToRoster,
  describeUpgrade,
  playerValue,
} from "../src/lib/upgrade.js";

/** Projections keyed by player then week. */
const PROJ: Record<string, Record<number, number>> = {
  target: { 1: 12, 2: 14, 3: 16 },
  stud: { 1: 20, 2: 20, 3: 20 },
  ok: { 1: 10, 2: 10, 3: 10 },
  weak: { 1: 4, 2: 4, 3: 4 },
  bye: { 1: 9, 3: 9 }, // week 2 missing — a bye, not a zero
  wr: { 1: 15, 2: 15, 3: 15 },
};

const projectedAt = (week: number, id: string) => PROJ[id]?.[week] ?? null;
const positions: Record<string, string> = {
  target: "RB",
  stud: "RB",
  ok: "RB",
  weak: "RB",
  bye: "RB",
  wr: "WR",
};
const positionOf = (id: string) => positions[id] ?? null;

describe("playerValue", () => {
  it("averages the rest of the season, not just this week", () => {
    // A roster spot is held for months; one week is a streaming decision.
    const v = playerValue("target", 1, projectedAt, 3);
    expect(v.thisWeek).toBe(12);
    expect(v.restOfSeason).toBeCloseTo(14, 10); // (12+14+16)/3
    expect(v.weeks).toBe(3);
  });

  it("skips weeks with no projection rather than counting them as zero", () => {
    // Averaging a bye in as 0 would understate the player by a third.
    const v = playerValue("bye", 1, projectedAt, 3);
    expect(v.restOfSeason).toBe(9);
    expect(v.weeks).toBe(2);
  });

  it("only looks forward from the given week", () => {
    const v = playerValue("target", 3, projectedAt, 3);
    expect(v.restOfSeason).toBe(16);
    expect(v.weeks).toBe(1);
  });

  it("reports nothing for a player with no projections", () => {
    const v = playerValue("ghost", 1, projectedAt, 3);
    expect(v).toMatchObject({ thisWeek: null, restOfSeason: null, weeks: 0 });
  });
});

describe("compareToRoster", () => {
  const roster = ["stud", "ok", "weak", "wr"];
  const starters = new Set(["stud", "wr"]);

  it("compares only against the same position", () => {
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    expect(c.candidates.map((x) => x.playerId)).not.toContain("wr");
  });

  it("orders weakest first, because the weakest is who gets dropped", () => {
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    expect(c.candidates.map((x) => x.playerId)).toEqual(["weak", "ok", "stud"]);
  });

  it("states the difference both ways", () => {
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    const weak = c.candidates[0]!;
    expect(weak.deltaThisWeek).toBe(8); // 12 - 4
    expect(weak.deltaRestOfSeason).toBeCloseTo(10, 10); // 14 - 4
  });

  it("keeps starters in the comparison rather than hiding them", () => {
    // A free agent beating someone you start is the most important row here.
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    const stud = c.candidates.find((x) => x.playerId === "stud")!;
    expect(stud.starting).toBe(true);
    expect(stud.deltaRestOfSeason).toBeCloseTo(-6, 10);
  });

  it("honours the limit", () => {
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 2);
    expect(c.candidates).toHaveLength(2);
  });

  it("flags an open slot when nothing is rostered at the position", () => {
    const c = compareToRoster("dst", "DEF", roster, positionOf, starters, 1, projectedAt);
    expect(c.openSlot).toBe(true);
    expect(c.candidates).toEqual([]);
  });

  it("never compares a player against himself", () => {
    const c = compareToRoster("ok", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    expect(c.candidates.map((x) => x.playerId)).not.toContain("ok");
  });

  it("leaves deltas null when either side has no projection", () => {
    const c = compareToRoster("ghost", "RB", ["weak"], positionOf, starters, 1, projectedAt, 3);
    expect(c.candidates[0]!.deltaRestOfSeason).toBeNull();
  });
});

describe("describeUpgrade", () => {
  const roster = ["stud", "ok", "weak"];
  const starters = new Set(["stud"]);

  it("calls out an open slot as a pure addition", () => {
    const c = compareToRoster("dst", "DEF", [], positionOf, starters, 1, projectedAt);
    expect(describeUpgrade(c)).toMatch(/pure addition/);
  });

  it("quantifies the gain over the weakest player", () => {
    const c = compareToRoster("target", "RB", roster, positionOf, starters, 1, projectedAt, 3);
    expect(describeUpgrade(c)).toBe("Worth 10.0 a week over your weakest");
  });

  it("says so when the target is worse than everyone", () => {
    const c = compareToRoster("weak", "RB", ["stud", "ok"], positionOf, starters, 1, projectedAt, 3);
    expect(describeUpgrade(c)).toMatch(/Downgrade/);
  });

  it("leads with the starter when the weakest rostered player is one", () => {
    const c = compareToRoster("target", "RB", ["stud"], positionOf, starters, 1, projectedAt, 3);
    expect(describeUpgrade(c)).toMatch(/Downgrade/); // stud out-projects target
    const better = compareToRoster("stud", "RB", ["ok"], positionOf, new Set(["ok"]), 1, projectedAt, 3);
    expect(describeUpgrade(better)).toBe("Upgrades a starter by 10.0 a week");
  });

  it("admits when there is nothing to compare on", () => {
    const c = compareToRoster("ghost", "RB", ["phantom"], () => "RB", starters, 1, projectedAt);
    expect(describeUpgrade(c)).toMatch(/Not enough projection/);
  });
});
