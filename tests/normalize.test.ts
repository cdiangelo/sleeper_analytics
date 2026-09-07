import { describe, expect, it } from "vitest";

import {
  buildTeams,
  faabHistory,
  freeAgents,
  keeperOptions,
  reconcileRosters,
  reconstructRosters,
} from "../src/lib/normalize.js";
import type { DraftPick, PlayerIndex, Roster, Transaction } from "../src/lib/types.js";

function pick(p: Partial<DraftPick> & { player_id: string; roster_id: number }): DraftPick {
  return {
    draft_id: "d1",
    pick_no: 1,
    round: 1,
    draft_slot: 1,
    picked_by: "u1",
    is_keeper: null,
    metadata: {},
    ...p,
  };
}

function tx(t: Partial<Transaction> & { transaction_id: string; created: number }): Transaction {
  return {
    type: "free_agent",
    status: "complete",
    status_updated: t.created,
    leg: 1,
    roster_ids: [],
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: null,
    ...t,
  };
}

function roster(r: Partial<Roster> & { roster_id: number }): Roster {
  return {
    owner_id: null,
    league_id: "l1",
    players: null,
    starters: null,
    reserve: null,
    taxi: null,
    keepers: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
    ...r,
  };
}

describe("reconstructRosters", () => {
  it("seeds rosters from the draft board", () => {
    const built = reconstructRosters(
      [
        pick({ player_id: "henry", roster_id: 5 }),
        pick({ player_id: "maye", roster_id: 5 }),
        pick({ player_id: "nacua", roster_id: 3 }),
      ],
      [],
    );
    expect([...built.get(5)!]).toEqual(["henry", "maye"]);
    expect([...built.get(3)!]).toEqual(["nacua"]);
  });

  it("applies adds and drops in the order Sleeper recorded them", () => {
    const built = reconstructRosters(
      [pick({ player_id: "henry", roster_id: 5 })],
      [
        tx({ transaction_id: "t1", created: 100, adds: { waiver1: 5 }, drops: { henry: 5 } }),
        tx({ transaction_id: "t2", created: 200, adds: { waiver2: 5 }, drops: { waiver1: 5 } }),
      ],
    );
    expect([...built.get(5)!]).toEqual(["waiver2"]);
  });

  it("replays out-of-order transactions chronologically", () => {
    const built = reconstructRosters(
      [pick({ player_id: "a", roster_id: 1 })],
      [
        tx({ transaction_id: "later", created: 200, adds: { a: 1 } }),
        tx({ transaction_id: "earlier", created: 100, drops: { a: 1 } }),
      ],
    );
    // Dropped first, re-added later: the player is on the roster.
    expect([...built.get(1)!]).toEqual(["a"]);
  });

  it("moves both sides of a trade", () => {
    const built = reconstructRosters(
      [pick({ player_id: "x", roster_id: 1 }), pick({ player_id: "y", roster_id: 2 })],
      [
        tx({
          transaction_id: "trade",
          created: 100,
          type: "trade",
          adds: { x: 2, y: 1 },
          drops: { x: 1, y: 2 },
        }),
      ],
    );
    expect([...built.get(1)!]).toEqual(["y"]);
    expect([...built.get(2)!]).toEqual(["x"]);
  });

  it("ignores pending and failed transactions", () => {
    const built = reconstructRosters(
      [pick({ player_id: "henry", roster_id: 5 })],
      [
        tx({ transaction_id: "p", created: 100, status: "pending", adds: { hopeful: 5 } }),
        tx({ transaction_id: "f", created: 200, status: "failed", drops: { henry: 5 } }),
      ],
    );
    expect([...built.get(5)!]).toEqual(["henry"]);
  });

  it("skips picks with no roster assigned yet", () => {
    const built = reconstructRosters([{ ...pick({ player_id: "x", roster_id: 1 }), roster_id: null }], []);
    expect(built.size).toBe(0);
  });
});

describe("reconcileRosters", () => {
  it("reports agreement when the draft board matches /rosters", () => {
    const built = reconstructRosters([pick({ player_id: "henry", roster_id: 5 })], []);
    const result = reconcileRosters(built, [roster({ roster_id: 5, players: ["henry"] })]);
    expect(result.agree).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.discrepancies).toEqual([]);
  });

  it("flags the documented case where /rosters still serves last season", () => {
    // Draft says roster 5 has Henry; Sleeper still reports last year's Bijan.
    const built = reconstructRosters([pick({ player_id: "henry", roster_id: 5 })], []);
    const result = reconcileRosters(built, [roster({ roster_id: 5, players: ["bijan"] })]);

    expect(result.agree).toBe(false);
    expect(result.discrepancies).toContainEqual({
      playerId: "henry",
      reconstructed: 5,
      reported: null,
    });
    expect(result.discrepancies).toContainEqual({
      playerId: "bijan",
      reconstructed: null,
      reported: 5,
    });
    expect(result.summary).toMatch(/disagrees/);
  });

  it("flags a player reported on the wrong team", () => {
    const built = reconstructRosters([pick({ player_id: "henry", roster_id: 5 })], []);
    const result = reconcileRosters(built, [roster({ roster_id: 3, players: ["henry"] })]);
    expect(result.discrepancies).toEqual([
      { playerId: "henry", reconstructed: 5, reported: 3 },
    ]);
  });
});

describe("keeperOptions", () => {
  const index: PlayerIndex = {
    maye: { id: "maye", name: "Drake Maye", pos: "QB", team: "NE", injury: null, number: 10, depthOrder: 1, rank: 40 },
    henry: { id: "henry", name: "Derrick Henry", pos: "RB", team: "BAL", injury: null, number: 22, depthOrder: 1, rank: 8 },
    pickup: { id: "pickup", name: "Waiver Guy", pos: "WR", team: "SF", injury: null, number: 8, depthOrder: 3, rank: 300 },
    kicker: { id: "kicker", name: "A Kicker", pos: "K", team: "SF", injury: null, number: 3, depthOrder: 1, rank: 400 },
  };

  const picks = [
    pick({ player_id: "maye", roster_id: 5, round: 10, is_keeper: true }),
    pick({ player_id: "henry", roster_id: 5, round: 1 }),
  ];

  it("escalates a keeper's cost by two rounds — Maye at R10 costs R8 next year", () => {
    const options = keeperOptions(5, ["maye"], picks, index);
    expect(options[0]).toMatchObject({
      name: "Drake Maye",
      draftedRound: 10,
      nextYearRound: 8,
      wasKeeper: true,
    });
  });

  it("floors a first-rounder at round 1 rather than going negative", () => {
    const options = keeperOptions(5, ["henry"], picks, index);
    expect(options[0]!.nextYearRound).toBe(1);
  });

  it("treats an undrafted waiver pickup as a seventh-round cost", () => {
    const options = keeperOptions(5, ["pickup"], picks, index);
    expect(options[0]).toMatchObject({ draftedRound: null, nextYearRound: 5 });
  });

  it("excludes kickers and defenses", () => {
    const options = keeperOptions(5, ["maye", "kicker"], picks, index);
    expect(options.map((o) => o.playerId)).toEqual(["maye"]);
  });

  it("sorts by cheapest keeper cost first", () => {
    const options = keeperOptions(5, ["maye", "henry", "pickup"], picks, index);
    expect(options.map((o) => o.nextYearRound)).toEqual([1, 5, 8]);
  });
});

describe("freeAgents", () => {
  const index: PlayerIndex = {
    a: { id: "a", name: "A", pos: "WR", team: "SF", injury: null, number: 1, depthOrder: 1, rank: 10 },
    b: { id: "b", name: "B", pos: "RB", team: "KC", injury: null, number: 2, depthOrder: 1, rank: 5 },
    c: { id: "c", name: "C", pos: "TE", team: "NE", injury: null, number: 3, depthOrder: 1, rank: null },
  };

  it("excludes rostered players and ranks the rest", () => {
    expect(freeAgents(index, ["a"]).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("sorts unranked players last", () => {
    expect(freeAgents(index, []).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
});

describe("faabHistory", () => {
  it("returns winning waiver bids newest first, ignoring free agent adds", () => {
    const history = faabHistory([
      tx({ transaction_id: "w1", created: 100, type: "waiver", adds: { p1: 5 }, settings: { waiver_bid: 12 } }),
      tx({ transaction_id: "w2", created: 300, type: "waiver", adds: { p2: 3 }, settings: { waiver_bid: 41 } }),
      tx({ transaction_id: "fa", created: 200, type: "free_agent", adds: { p3: 1 } }),
      tx({ transaction_id: "w3", created: 400, type: "waiver", status: "failed", adds: { p4: 2 }, settings: { waiver_bid: 99 } }),
    ]);

    expect(history.map((h) => h.playerId)).toEqual(["p2", "p1"]);
    expect(history[0]).toMatchObject({ rosterId: 3, bid: 41 });
  });
});

describe("buildTeams", () => {
  it("prefers the Sleeper team name, falling back to the owner", () => {
    const teams = buildTeams(
      [
        { user_id: "u1", display_name: "TDCity69", avatar: null, metadata: { team_name: "Sand Francisco" } },
        { user_id: "u2", display_name: "PrinceSpaghetti", avatar: null, metadata: {} },
      ],
      [roster({ roster_id: 5, owner_id: "u1" }), roster({ roster_id: 7, owner_id: "u2" })],
      100,
    );
    expect(teams[0]!.name).toBe("Sand Francisco");
    expect(teams[1]!.name).toBe("PrinceSpaghetti");
  });

  it("reassembles split fantasy point fields and FAAB", () => {
    const teams = buildTeams(
      [],
      [
        roster({
          roster_id: 5,
          settings: {
            wins: 2,
            losses: 1,
            ties: 0,
            fpts: 312,
            fpts_decimal: 46,
            fpts_against: 288,
            fpts_against_decimal: 5,
            waiver_budget_used: 23,
          },
        }),
      ],
      100,
    );
    expect(teams[0]!.pointsFor).toBeCloseTo(312.46, 10);
    expect(teams[0]!.pointsAgainst).toBeCloseTo(288.05, 10);
    expect(teams[0]!.faabRemaining).toBe(77);
  });
});
