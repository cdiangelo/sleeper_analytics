/**
 * Slice 1 deliverable: fetch the whole league, normalize it, write it to
 * fixtures/ as JSON, and verify it against the known truths in the build spec.
 *
 * Run anywhere with open network access to api.sleeper.app:
 *   npm run dump
 *
 * In CI this runs on a GitHub Actions runner and commits the result, so the
 * fixture stays current without anyone fetching by hand.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DRAFT_ID,
  DRAFT_SLOT,
  DRAFT_ROUNDS,
  KEEPERS_2026,
  LEAGUE_ID,
  PREV_LEAGUE,
  ROSTER_ID,
  TEAM_COUNT,
} from "../src/lib/constants.js";
import { verifyScoring } from "../src/lib/scoring.js";
import {
  getDraft,
  getDraftPicks,
  getLeague,
  getLeagueUsers,
  getMatchups,
  getNflState,
  getProjections,
  getRawPlayers,
  getRosters,
  getTransactions,
  getTrendingAdds,
  trimPlayerIndex,
} from "../src/lib/sleeper.js";
import type {
  LeagueSnapshot,
  Matchup,
  Projection,
  Transaction,
} from "../src/lib/types.js";

const OUT_DIR = path.resolve(process.cwd(), "fixtures");
/**
 * The trimmed index ships with the build so a cold load renders immediately
 * instead of waiting on a 10MB download.
 */
const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const warnings: string[] = [];

/** Run a fetch, downgrade any failure to a warning plus a fallback value. */
async function soft<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`${label} failed: ${msg}`);
    console.warn(`  ! ${label} failed: ${msg}`);
    return fallback;
  }
}

async function main() {
  console.log("Fetching league state from Sleeper...\n");

  const state = await getNflState();
  console.log(
    `NFL state: ${state.season} ${state.season_type}, week ${state.week} ` +
      `(season start ${state.season_start_date})`,
  );

  const [league, users, rosters] = await Promise.all([
    getLeague(LEAGUE_ID),
    getLeagueUsers(LEAGUE_ID),
    getRosters(LEAGUE_ID),
  ]);
  console.log(`League: ${league.name} — ${league.total_rosters} teams, ${league.status}`);

  const draft = await soft("draft", () => getDraft(DRAFT_ID), null);
  const draftPicks = await soft("draft picks", () => getDraftPicks(DRAFT_ID), []);
  console.log(`Draft: ${draftPicks.length} picks recorded`);

  // Matchups and transactions for every week up to and including the current
  // one. Preseason weeks return rows with zeroed points; empty weeks are
  // dropped so the UI can distinguish "not played" from "played, scored zero".
  const throughWeek = Math.max(1, state.week);
  const matchups: Record<number, Matchup[]> = {};
  const transactions: Record<number, Transaction[]> = {};

  for (let week = 1; week <= throughWeek; week++) {
    const rows = await soft(`matchups w${week}`, () => getMatchups(LEAGUE_ID, week), []);
    if (rows.length > 0) matchups[week] = rows;

    const tx = await soft(
      `transactions w${week}`,
      () => getTransactions(LEAGUE_ID, week),
      [],
    );
    if (tx.length > 0) transactions[week] = tx;
  }
  console.log(
    `Matchups: weeks ${Object.keys(matchups).join(", ") || "(none)"} | ` +
      `Transactions: ${Object.values(transactions).flat().length} total`,
  );

  const trendingAdds = await soft("trending adds", () => getTrendingAdds(24, 50), []);

  const projections = await soft(
    `projections ${state.season} w${throughWeek}`,
    () => getProjections(state.season, throughWeek),
    {},
  );
  const withStats = Object.values(projections).filter(
    (p) => p.stats && Object.keys(p.stats).some((k) => k !== "adp_dd_ppr"),
  ).length;
  console.log(
    `Projections: ${Object.keys(projections).length} players, ${withStats} with real stat lines`,
  );
  if (Object.keys(projections).length > 0 && withStats === 0) {
    warnings.push(
      `Projections for week ${throughWeek} return placeholders only (no stat lines published yet).`,
    );
  }

  console.log("Fetching player index (~10MB, this is the slow one)...");
  const rawPlayers = await getRawPlayers();
  const players = trimPlayerIndex(rawPlayers);
  console.log(
    `Player index: ${Object.keys(rawPlayers).length} raw -> ${Object.keys(players).length} fantasy-relevant`,
  );

  /**
   * Whole-season projections, shipped with the build.
   *
   * Fetching these from a phone is hopeless — a week is ~2MB and the season is
   * ~34MB. But only rostered players are ever plotted, and only stat keys this
   * league scores affect the math, so trimming on both axes leaves ~29KB a
   * week. The runner pays the 34MB once a week so the client pays 0.5MB.
   */
  const rostered = new Set<string>();
  for (const roster of rosters) for (const id of roster.players ?? []) rostered.add(id);
  const scoredKeys = new Set(Object.keys(league.scoring_settings));

  const seasonProjections: Record<number, Record<string, Record<string, number>>> = {};
  let projectionWeeks = 0;

  for (let w = 1; w <= 17; w++) {
    const rows = await soft(
      `season projections w${w}`,
      () => getProjections(state.season, w),
      {} as Record<string, Projection>,
    );

    const trimmed: Record<string, Record<string, number>> = {};
    for (const id of rostered) {
      const stats = rows[id]?.stats;
      if (!stats) continue;
      const slim: Record<string, number> = {};
      for (const [key, value] of Object.entries(stats)) {
        if (scoredKeys.has(key) && typeof value === "number") slim[key] = value;
      }
      if (Object.keys(slim).length > 0) trimmed[id] = slim;
    }

    if (Object.keys(trimmed).length > 0) {
      seasonProjections[w] = trimmed;
      projectionWeeks++;
    }
  }
  console.log(
    `Season projections: ${projectionWeeks} weeks with stat lines, ${rostered.size} rostered players`,
  );

  const prevSeason = await soft(
    "previous season",
    async () => {
      const [prevLeague, prevUsers, prevRosters] = await Promise.all([
        getLeague(PREV_LEAGUE),
        getLeagueUsers(PREV_LEAGUE),
        getRosters(PREV_LEAGUE),
      ]);
      return { league: prevLeague, users: prevUsers, rosters: prevRosters };
    },
    null,
  );
  console.log(
    `Previous season: ${prevSeason ? `${prevSeason.league.season}, ${prevSeason.rosters.length} teams` : "unavailable"}`,
  );

  const snapshot: LeagueSnapshot = {
    fetchedAt: new Date().toISOString(),
    state,
    league,
    users,
    rosters,
    draft,
    draftPicks,
    matchups,
    transactions,
    trendingAdds,
    projections,
    prevSeason,
    warnings,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "league-state.json"),
    JSON.stringify(snapshot, null, 2),
  );
  await writeFile(path.join(PUBLIC_DIR, "players.json"), JSON.stringify(players));
  await writeFile(
    path.join(PUBLIC_DIR, "projections.json"),
    JSON.stringify({
      season: state.season,
      generatedAt: new Date().toISOString(),
      weeks: seasonProjections,
    }),
  );

  console.log(
    `\nWrote fixtures/league-state.json, public/players.json and public/projections.json`,
  );

  verify(snapshot, players);
}

/**
 * Check the snapshot against the truths in spec §9. These are assertions about
 * reality, not about our code — a failure means either Sleeper changed or the
 * spec's assumptions have drifted, and either way it needs eyes.
 */
function verify(snap: LeagueSnapshot, players: Record<string, { name: string }>) {
  console.log("\n--- Verification against known truths ---");
  const results: Array<[string, boolean, string]> = [];
  const check = (label: string, pass: boolean, detail: string) =>
    results.push([label, pass, detail]);

  check(
    "10 teams",
    snap.league.total_rosters === TEAM_COUNT,
    `total_rosters=${snap.league.total_rosters}`,
  );
  check("10 rosters returned", snap.rosters.length === TEAM_COUNT, `${snap.rosters.length}`);
  check(
    "154+ draft picks",
    snap.draftPicks.length >= 154,
    `${snap.draftPicks.length} picks (full draft = ${TEAM_COUNT * DRAFT_ROUNDS})`,
  );
  check(
    "17 draft rounds",
    snap.draft?.settings.rounds === DRAFT_ROUNDS,
    `draft.settings.rounds=${snap.draft?.settings.rounds}`,
  );

  const mine = snap.rosters.find((r) => r.roster_id === ROSTER_ID);
  check("roster_id 5 exists", !!mine, mine ? `${mine.players?.length ?? 0} players` : "missing");

  const myFirst = snap.draftPicks
    .filter((p) => p.draft_slot === DRAFT_SLOT && p.round === 1)
    .map((p) => `${p.metadata.first_name} ${p.metadata.last_name}`.trim());
  check(
    "R1 at slot 9 is Derrick Henry",
    myFirst[0] === "Derrick Henry",
    myFirst[0] ?? "no pick found",
  );

  const keeperPicks = snap.draftPicks.filter((p) => p.is_keeper);
  check(
    "10 keepers league-wide",
    keeperPicks.length === KEEPERS_2026.length,
    `${keeperPicks.length} picks flagged is_keeper`,
  );

  for (const { player, round } of KEEPERS_2026) {
    const hit = snap.draftPicks.find(
      (p) => `${p.metadata.first_name} ${p.metadata.last_name}`.trim() === player,
    );
    check(
      `keeper ${player} @ R${round}`,
      hit?.round === round,
      hit ? `found at R${hit.round} (is_keeper=${hit.is_keeper})` : "not in draft",
    );
  }

  const mismatches = verifyScoring(snap.league.scoring_settings);
  check(
    "scoring matches spec §4",
    mismatches.length === 0,
    mismatches.length === 0
      ? "all weights match"
      : mismatches.map((m) => `${m.key}: expected ${m.expected}, got ${m.actual}`).join("; "),
  );

  // The spec's headline gotcha: rosters lag the draft. Compare drafted players
  // against what /rosters currently claims each team holds.
  const draftedToRoster = new Map<string, number>();
  for (const p of snap.draftPicks) {
    if (p.roster_id != null) draftedToRoster.set(p.player_id, p.roster_id);
  }
  let agree = 0;
  let disagree = 0;
  for (const [playerId, rosterId] of draftedToRoster) {
    const holder = snap.rosters.find((r) => r.players?.includes(playerId));
    if (!holder) disagree++;
    else if (holder.roster_id === rosterId) agree++;
    else disagree++;
  }
  check(
    "rosters reconcile with draft",
    disagree === 0,
    `${agree} agree, ${disagree} disagree of ${draftedToRoster.size} drafted`,
  );

  check(
    "player index resolves drafted players",
    snap.draftPicks.every((p) => !!players[p.player_id]),
    `${snap.draftPicks.filter((p) => !players[p.player_id]).length} unresolved`,
  );

  let failed = 0;
  for (const [label, pass, detail] of results) {
    if (!pass) failed++;
    console.log(`${pass ? "  PASS" : "  FAIL"}  ${label} — ${detail}`);
  }
  console.log(
    `\n${results.length - failed}/${results.length} checks passed` +
      (warnings.length ? `, ${warnings.length} fetch warning(s)` : ""),
  );
  for (const w of warnings) console.log(`  warning: ${w}`);
}

main().catch((err) => {
  console.error("\nDump failed:", err);
  process.exit(1);
});
