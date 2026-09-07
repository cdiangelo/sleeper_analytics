import { describe, expect, it } from "vitest";

import { describeWaiverMode, waiverMode } from "../src/lib/normalize.js";
import snapshot from "../fixtures/league-state.json" with { type: "json" };
import type { LeagueSnapshot } from "../src/lib/types.js";

const snap = snapshot as unknown as LeagueSnapshot;

describe("waiverMode", () => {
  it("reads the mode from the league rather than assuming FAAB", () => {
    // waiver_budget is present and set to 100 even in a rolling league, so
    // trusting it renders dollars for a league that has never had any.
    expect(waiverMode({ waiver_type: 0 })).toBe("rolling");
    expect(waiverMode({ waiver_type: 1 })).toBe("reverse");
    expect(waiverMode({ waiver_type: 2 })).toBe("faab");
  });

  it("falls back to rolling when the setting is missing", () => {
    expect(waiverMode({})).toBe("rolling");
  });

  it("describes what winning a claim costs", () => {
    expect(describeWaiverMode("rolling")).toMatch(/drops you to last/);
    expect(describeWaiverMode("faab")).toMatch(/FAAB/);
  });
});

describe("this league's actual waiver settings", () => {
  it("runs rolling priority, not FAAB", () => {
    expect(waiverMode(snap.league.settings)).toBe("rolling");
  });

  it("still reports a waiver_budget, which is the trap", () => {
    // Present but meaningless here. The build spec read it as FAAB 100.
    expect(snap.league.settings.waiver_budget).toBe(100);
  });

  it("gives every team a priority position", () => {
    const positions = snap.rosters
      .map((r) => r.settings.waiver_position)
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("has nobody having spent FAAB, because there is none to spend", () => {
    expect(snap.rosters.every((r) => (r.settings.waiver_budget_used ?? 0) === 0)).toBe(true);
  });
});
