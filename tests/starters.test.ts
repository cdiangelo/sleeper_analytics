import { describe, expect, it } from "vitest";

import { startersFor } from "../src/app/views.js";
import type { AppState } from "../src/app/store.js";
import type { Matchup, Roster } from "../src/lib/types.js";

/** Only the fields startersFor reads. */
function stateWith(
  rosterStarters: string[] | null,
  matchupStarters: string[] | null,
): AppState {
  const roster = {
    roster_id: 5,
    owner_id: null,
    league_id: "l",
    players: ["laporta", "hhenry", "maye"],
    starters: rosterStarters,
    reserve: null,
    taxi: null,
    keepers: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  } satisfies Roster;

  const matchup = {
    roster_id: 5,
    matchup_id: 1,
    points: 0,
    custom_points: null,
    starters: matchupStarters,
    starters_points: null,
    players: null,
    players_points: null,
  } satisfies Matchup;

  return {
    state: { week: 1 },
    rosters: [roster],
    matchups: matchupStarters ? { 1: [matchup] } : {},
  } as unknown as AppState;
}

describe("startersFor", () => {
  it("prefers the matchup lineup, which refreshes every 60s", () => {
    // The roster endpoint is hourly, so a start/sit change lands here first.
    // Reading the stale one made an edited lineup look like it was ignored.
    const s = stateWith(["hhenry", "maye"], ["laporta", "maye"]);
    expect([...startersFor(s, 5)].sort()).toEqual(["laporta", "maye"]);
  });

  it("falls back to the roster when no matchup row exists", () => {
    const s = stateWith(["hhenry", "maye"], null);
    expect([...startersFor(s, 5)].sort()).toEqual(["hhenry", "maye"]);
  });

  it("falls back when the matchup row has an empty lineup", () => {
    const s = stateWith(["hhenry"], []);
    expect([...startersFor(s, 5)]).toEqual(["hhenry"]);
  });

  it("drops Sleeper's empty-slot placeholders", () => {
    const s = stateWith(null, ["laporta", "0", ""]);
    expect([...startersFor(s, 5)]).toEqual(["laporta"]);
  });

  it("returns nothing for a roster it does not know", () => {
    expect(startersFor(stateWith(["maye"], null), 9).size).toBe(0);
  });
});
