import { describe, expect, it } from "vitest";

import { depthChartContext, describeDepth } from "../src/lib/depth.js";
import {
  describeChange,
  diffInjuries,
  injurySeverity,
  injurySnapshot,
  mergeChanges,
  pruneChanges,
  type StatusChange,
} from "../src/lib/news.js";
import type { Player, PlayerIndex } from "../src/lib/types.js";

function player(p: Partial<Player> & { id: string }): Player {
  return {
    name: p.id,
    pos: "RB",
    team: "SF",
    injury: null,
    number: null,
    depthOrder: null,
    rank: null,
    ...p,
  };
}

const index = (...players: Player[]): PlayerIndex =>
  Object.fromEntries(players.map((p) => [p.id, p]));

describe("injurySeverity", () => {
  it("ranks statuses from healthy to season-ending", () => {
    expect(injurySeverity(null)).toBe(0);
    expect(injurySeverity("Questionable")).toBeLessThan(injurySeverity("Doubtful"));
    expect(injurySeverity("Doubtful")).toBeLessThan(injurySeverity("Out"));
    expect(injurySeverity("Out")).toBeLessThan(injurySeverity("IR"));
  });

  it("treats an unrecognised status as worse than questionable", () => {
    // Unknown is not good news; erring healthy would hide a real absence.
    expect(injurySeverity("Reserve/Whatever")).toBeGreaterThan(
      injurySeverity("Questionable"),
    );
  });
});

describe("diffInjuries", () => {
  const before = injurySnapshot(
    index(
      player({ id: "a", injury: "Questionable" }),
      player({ id: "b", injury: null }),
      player({ id: "c", injury: "Out" }),
    ),
  );

  it("only records players who carry a status", () => {
    expect(before).toEqual({ a: "Questionable", c: "Out" });
  });

  it("flags a newly injured player", () => {
    const changes = diffInjuries(before, index(player({ id: "b", injury: "Out" })));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ playerId: "b", from: null, to: "Out", improved: false });
  });

  it("flags a player who has been cleared", () => {
    const changes = diffInjuries(before, index(player({ id: "a", injury: null })));
    expect(changes[0]).toMatchObject({ from: "Questionable", to: null, improved: true });
  });

  it("flags a worsening status", () => {
    const changes = diffInjuries(before, index(player({ id: "a", injury: "Out" })));
    expect(changes[0]).toMatchObject({ from: "Questionable", to: "Out", improved: false });
  });

  it("reports nothing when nothing moved", () => {
    const same = index(player({ id: "a", injury: "Questionable" }), player({ id: "c", injury: "Out" }));
    expect(diffInjuries(before, same)).toEqual([]);
  });

  it("reports nothing on the very first run", () => {
    // An empty snapshot must not read as "the whole league just got hurt".
    expect(diffInjuries({}, index(player({ id: "a", injury: "Out" })))).toEqual([]);
  });

  it("ignores players who left the index entirely", () => {
    // a and c were injured in the snapshot and are absent from the new index.
    // Released or no longer fantasy-relevant is not a recovery to report.
    expect(diffInjuries(before, index(player({ id: "z" })))).toEqual([]);
  });

  it("sorts the worst news first", () => {
    const changes = diffInjuries(
      before,
      index(player({ id: "a", injury: null }), player({ id: "b", injury: "IR" })),
    );
    expect(changes.map((c) => c.playerId)).toEqual(["b", "a"]);
  });
});

describe("mergeChanges", () => {
  const older: StatusChange = { playerId: "a", from: null, to: "Questionable", improved: false, at: 100 };
  const newer: StatusChange = { playerId: "a", from: "Questionable", to: "Out", improved: false, at: 200 };

  it("keeps one entry per player — the latest", () => {
    // Questionable then Out inside a week is one story, not two.
    const merged = mergeChanges([older], [newer]);
    expect(merged).toEqual([newer]);
  });

  it("keeps separate players apart", () => {
    const other: StatusChange = { ...older, playerId: "b", at: 150 };
    expect(mergeChanges([older], [other]).map((c) => c.playerId).sort()).toEqual(["a", "b"]);
  });

  it("orders newest first", () => {
    const other: StatusChange = { ...older, playerId: "b", at: 300 };
    expect(mergeChanges([older], [other])[0]!.playerId).toBe("b");
  });
});

describe("pruneChanges", () => {
  it("drops anything past the window", () => {
    const now = 10_000_000;
    const week = 7 * 24 * 60 * 60_000;
    const fresh: StatusChange = { playerId: "a", from: null, to: "Out", improved: false, at: now - 1000 };
    const stale: StatusChange = { ...fresh, playerId: "b", at: now - week - 1 };
    expect(pruneChanges([fresh, stale], week, now).map((c) => c.playerId)).toEqual(["a"]);
  });
});

describe("describeChange", () => {
  it("reads naturally in each direction", () => {
    expect(describeChange({ playerId: "a", from: null, to: "Out", improved: false, at: 0 })).toBe("now Out");
    expect(describeChange({ playerId: "a", from: "Out", to: null, improved: true, at: 0 })).toBe("cleared from Out");
    expect(describeChange({ playerId: "a", from: "Questionable", to: "Out", improved: false, at: 0 })).toBe(
      "Questionable → Out",
    );
  });
});

describe("depthChartContext", () => {
  const chart = index(
    player({ id: "rb1", name: "Starter", depthOrder: 1 }),
    player({ id: "rb2", name: "Backup", depthOrder: 2 }),
    player({ id: "rb3", name: "Third", depthOrder: 3 }),
    player({ id: "wr1", name: "Receiver", pos: "WR", depthOrder: 1 }),
    player({ id: "other", name: "Other Team RB", team: "KC", depthOrder: 1 }),
  );

  it("lists only same team, same position, ranked ahead", () => {
    const ctx = depthChartContext(chart, "rb3");
    expect(ctx.ahead.map((p) => p.playerId)).toEqual(["rb1", "rb2"]);
  });

  it("finds no opportunity while the starter is healthy", () => {
    expect(depthChartContext(chart, "rb2").opportunity).toBe(false);
  });

  it("calls it an opportunity once everyone ahead is out", () => {
    const hurt = { ...chart, rb1: player({ id: "rb1", name: "Starter", depthOrder: 1, injury: "Out" }) };
    const ctx = depthChartContext(hurt, "rb2");
    expect(ctx.opportunity).toBe(true);
    expect(describeDepth(ctx)).toBe("next up — Starter out");
  });

  it("does not promote the third stringer when only the starter is out", () => {
    const hurt = { ...chart, rb1: player({ id: "rb1", name: "Starter", depthOrder: 1, injury: "Out" }) };
    const ctx = depthChartContext(hurt, "rb3");
    expect(ctx.opportunity).toBe(false);
    // Still worth saying — the path is one injury shorter than it was.
    expect(describeDepth(ctx)).toBe("Starter out ahead");
  });

  it("treats questionable ahead as too weak to act on", () => {
    const q = { ...chart, rb1: player({ id: "rb1", name: "Starter", depthOrder: 1, injury: "Questionable" }) };
    expect(depthChartContext(q, "rb2").opportunity).toBe(false);
  });

  it("is not an opportunity for someone with nobody ahead", () => {
    // A starter is not a waiver opportunity, he is just a starter.
    expect(depthChartContext(chart, "rb1").opportunity).toBe(false);
  });

  it("returns empty context when the depth chart is unknown", () => {
    const unknown = index(player({ id: "x", depthOrder: null }));
    expect(depthChartContext(unknown, "x")).toMatchObject({ order: null, ahead: [] });
    expect(describeDepth(depthChartContext(unknown, "x"))).toBe("");
  });
});

describe("depthChartContext noise control", () => {
  /**
   * Sleeper's depth_chart_order runs deep and gets unreliable past the top few.
   * Real data threw up "Dennis Houston (WR8 TB), David Sills IR ahead" as an
   * opportunity — technically true, entirely useless.
   */
  const deep = index(
    player({ id: "wr1", name: "Starter", pos: "WR", depthOrder: 1 }),
    player({ id: "wr2", name: "Second", pos: "WR", depthOrder: 2 }),
    player({ id: "wr7", name: "Seventh", pos: "WR", depthOrder: 7, injury: "IR" }),
    player({ id: "wr8", name: "Eighth", pos: "WR", depthOrder: 8 }),
  );

  it("ignores an injured player buried down the chart", () => {
    const ctx = depthChartContext(deep, "wr8");
    expect(ctx.ahead.map((p) => p.playerId)).toEqual(["wr1", "wr2"]);
    expect(ctx.opportunity).toBe(false);
  });

  it("does not promote someone too deep to benefit", () => {
    // Both starters out, but an eighth-stringer is still not next up.
    const hurt = {
      ...deep,
      wr1: player({ id: "wr1", name: "Starter", pos: "WR", depthOrder: 1, injury: "Out" }),
      wr2: player({ id: "wr2", name: "Second", pos: "WR", depthOrder: 2, injury: "IR" }),
    };
    expect(depthChartContext(hurt, "wr8").opportunity).toBe(false);
    expect(depthChartContext(hurt, "wr7").opportunity).toBe(false);
  });

  it("still promotes a genuine next man up", () => {
    const hurt = {
      ...deep,
      wr1: player({ id: "wr1", name: "Starter", pos: "WR", depthOrder: 1, injury: "Out" }),
      wr3: player({ id: "wr3", name: "Third", pos: "WR", depthOrder: 3 }),
    };
    const ctx = depthChartContext(hurt, "wr2");
    expect(ctx.opportunity).toBe(true);
    expect(describeDepth(ctx)).toBe("next up — Starter out");
  });
});
