/**
 * Verification against known truths, run against the real league snapshot in
 * fixtures/. The unit tests prove the math; this proves the math is being fed
 * the shapes Sleeper actually returns.
 *
 * The fixture is refreshed by .github/workflows/refresh-fixture.yml, so these
 * assertions also catch upstream drift.
 */

import { describe, expect, it } from "vitest";

import snapshot from "../fixtures/league-state.json" with { type: "json" };
import {
  DRAFT_ROUNDS,
  DRAFT_SLOT,
  KEEPERS_2026,
  ROSTER_ID,
  TEAM_COUNT,
} from "../src/lib/constants.js";
import { allPlayStandings, playedWeeks, startingSlots } from "../src/lib/metrics.js";
import {
  allRosteredPlayers,
  keeperOptions,
  reconcileRosters,
  reconstructRosters,
} from "../src/lib/normalize.js";
import { verifyScoring } from "../src/lib/scoring.js";
import type { LeagueSnapshot, PlayerIndex } from "../src/lib/types.js";
import players from "../public/players.json" with { type: "json" };

const snap = snapshot as unknown as LeagueSnapshot;
const index = players as unknown as PlayerIndex;
const allTransactions = Object.values(snap.transactions).flat();

describe("league shape", () => {
  it("is a 10-team league", () => {
    expect(snap.league.total_rosters).toBe(TEAM_COUNT);
    expect(snap.rosters).toHaveLength(TEAM_COUNT);
  });

  it("runs the starting lineup the spec describes", () => {
    expect(startingSlots(snap.league.roster_positions)).toEqual([
      "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF",
    ]);
  });

  it("matches the league settings the spec documents", () => {
    expect(snap.league.settings.playoff_week_start).toBe(15);
    expect(snap.league.settings.trade_deadline).toBe(11);
    expect(snap.league.settings.waiver_budget).toBe(100);
    expect(snap.league.settings.playoff_teams).toBe(6);
  });
});

describe("scoring", () => {
  it("matches every weight in spec section 4", () => {
    expect(verifyScoring(snap.league.scoring_settings)).toEqual([]);
  });
});

describe("draft", () => {
  it("is a complete 17-round draft", () => {
    expect(snap.draft?.settings.rounds).toBe(DRAFT_ROUNDS);
    expect(snap.draftPicks.length).toBe(TEAM_COUNT * DRAFT_ROUNDS);
  });

  it("has Derrick Henry as the round 1 pick at draft slot 9", () => {
    const first = snap.draftPicks.find(
      (p) => p.draft_slot === DRAFT_SLOT && p.round === 1,
    );
    expect(`${first?.metadata.first_name} ${first?.metadata.last_name}`).toBe(
      "Derrick Henry",
    );
    expect(first?.roster_id).toBe(ROSTER_ID);
  });

  it("has the ten documented keepers at their documented rounds", () => {
    const keepers = snap.draftPicks
      .filter((p) => p.is_keeper)
      .map((p) => ({
        player: `${p.metadata.first_name} ${p.metadata.last_name}`,
        round: p.round,
      }));

    expect(keepers).toHaveLength(KEEPERS_2026.length);
    for (const expected of KEEPERS_2026) {
      expect(keepers).toContainEqual(expected);
    }
  });

  it("prices Drake Maye at round 8 for next season", () => {
    const mine = snap.rosters.find((r) => r.roster_id === ROSTER_ID)!;
    const options = keeperOptions(
      ROSTER_ID,
      mine.players ?? [],
      snap.draftPicks,
      index,
    );
    expect(options.find((o) => o.name === "Drake Maye")).toMatchObject({
      draftedRound: 10,
      nextYearRound: 8,
      wasKeeper: true,
    });
  });
});

describe("roster reconstruction", () => {
  it("reconciles with /rosters once transactions are replayed", () => {
    const rebuilt = reconstructRosters(snap.draftPicks, allTransactions);
    const result = reconcileRosters(rebuilt, snap.rosters);

    // The draft board alone disagrees with /rosters on players who have since
    // been dropped. Replaying the transaction log is what closes the gap.
    expect(result.discrepancies).toEqual([]);
    expect(result.agree).toBe(true);
  });

  it("resolves every drafted player through the player index", () => {
    // A drafted player missing from the trimmed index would render as a bare
    // numeric id, so the trim must not drop anyone who was drafted.
    const rostered = allRosteredPlayers(snap.rosters);
    const unresolved = [...rostered].filter((id) => !index[id]);
    expect(unresolved).toEqual([]);
  });
});

describe("preseason empty state", () => {
  it("reports no played weeks before kickoff", () => {
    // Sleeper returns fully formed week 1 rows with zeroed points well before
    // the games are played. Row presence must never be read as a result.
    if (snap.matchups[1]?.every((m) => (m.points ?? 0) === 0)) {
      expect(playedWeeks(snap.matchups)).toEqual([]);
      expect(allPlayStandings(snap.matchups)).toEqual([]);
    }
  });

  it("still pairs every team into a matchup", () => {
    const week1 = snap.matchups[1] ?? [];
    if (week1.length > 0) {
      const ids = week1.map((m) => m.matchup_id);
      expect(new Set(ids).size).toBe(TEAM_COUNT / 2);
    }
  });
});
