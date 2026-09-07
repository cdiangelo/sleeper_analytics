/**
 * Screens. Each renders to an HTML string from AppState and nothing else.
 *
 * Empty states are written first, not last: week 1 has no scores until
 * kickoff, so every screen has to read well with nothing in it.
 */

import { FLEX_ELIGIBLE } from "../lib/constants.js";
import {
  allPlayStandings,
  benchReports,
  consistency,
  mean,
  opponentStrength,
  optimalLineup,
  playedWeeks,
  positionalEdge,
  trendSeries,
  weekScores,
  type PositionLookup,
} from "../lib/metrics.js";
import {
  describeWaiverMode,
  faabHistory,
  freeAgents,
  keeperOptions,
  waiverMode,
} from "../lib/normalize.js";
import { depthChartContext, describeDepth } from "../lib/depth.js";
import { describeChange } from "../lib/news.js";
import { leaguePoints, scoringEdge } from "../lib/scoring.js";
import type { Matchup } from "../lib/types.js";
import {
  barCell,
  emphasisLineChart,
  lineChart,
  seasonSpark,
  sparkline,
  type EmphasisSeries,
} from "./charts.js";
import {
  playerSeries,
  populatedWeeks,
  seriesMax,
  type PlayerSeries,
} from "../lib/series.js";
import {
  esc,
  injuryTag,
  num,
  ordinal,
  pct,
  posTag,
  record,
  signed,
  signedPct,
  toneClass,
} from "./format.js";
import { myRosterId, rosteredPlayers, type AppState } from "./store.js";

export type Tab = "now" | "team" | "performance" | "league" | "waivers";

// --- shared helpers ---------------------------------------------------------

function posOf(s: AppState): PositionLookup {
  return (id) => s.players[id]?.pos ?? null;
}

function playerName(s: AppState, id: string): string {
  return s.players[id]?.name ?? id;
}

/** Owner name for the current user, used to find them across seasons where
 *  roster ids do not carry over. */
function mineOwner(s: AppState): string | undefined {
  return s.teams.find((t) => t.rosterId === myRosterId())?.owner;
}

function teamName(s: AppState, rosterId: number | null | undefined): string {
  if (rosterId == null) return "—";
  return s.teams.find((t) => t.rosterId === rosterId)?.name ?? `Roster ${rosterId}`;
}

/**
 * League-scored projection for a player. Returns null when projections have
 * not published stat lines yet, so screens can say so instead of showing 0.0.
 */
function projected(s: AppState, playerId: string): number | null {
  const stats = s.projections[playerId]?.stats;
  if (!stats) return null;
  const meaningful = Object.keys(stats).some(
    (k) => k !== "adp_dd_ppr" && k !== "pos_adp_dd_ppr",
  );
  if (!meaningful) return null;
  return leaguePoints(stats, s.league.scoring_settings);
}

function currentWeek(s: AppState): number {
  return Math.max(1, s.state.week);
}

/**
 * Who a team is actually starting this week.
 *
 * Two endpoints answer this and they refresh at very different rates:
 * `/matchups` carries the week's lineup and is refetched every 60 seconds,
 * while `/rosters` is hourly. A start/sit change made in Sleeper therefore
 * shows up in the matchup rows almost immediately and in the roster rows much
 * later, so the matchup row wins wherever it exists. Nothing here needs a
 * redeploy — both come live from Sleeper in the browser.
 */
export function startersFor(s: AppState, rosterId: number): Set<string> {
  const week = currentWeek(s);
  const fromMatchup = s.matchups[week]?.find((m) => m.roster_id === rosterId)?.starters;
  if (fromMatchup && fromMatchup.length > 0) {
    return new Set(fromMatchup.filter((id) => id && id !== "0"));
  }
  const fromRoster = s.rosters.find((r) => r.roster_id === rosterId)?.starters;
  return new Set((fromRoster ?? []).filter((id) => id && id !== "0"));
}

/** The starting lineup in slot order, for rendering against roster_positions. */
function startingLineup(s: AppState, rosterId: number): string[] {
  const week = currentWeek(s);
  const fromMatchup = s.matchups[week]?.find((m) => m.roster_id === rosterId)?.starters;
  if (fromMatchup && fromMatchup.length > 0) return fromMatchup;
  return s.rosters.find((r) => r.roster_id === rosterId)?.starters ?? [];
}

/** League-scored projection for a specific week, or null if none is loaded. */
function projectedForWeek(s: AppState, week: number, playerId: string): number | null {
  const stats = s.projectionsByWeek[week]?.[playerId]?.stats;
  if (!stats) return null;
  const meaningful = Object.keys(stats).some(
    (k) => k !== "adp_dd_ppr" && k !== "pos_adp_dd_ppr",
  );
  if (!meaningful) return null;
  return leaguePoints(stats, s.league.scoring_settings);
}

/**
 * One line per player on the roster, actual and projected. Shared by the row
 * sparklines and the season chart so the two can never disagree.
 */
export function rosterSeries(s: AppState): PlayerSeries[] {
  const mine = s.rosters.find((r) => r.roster_id === myRosterId());
  const starters = startersFor(s, myRosterId());

  return (mine?.players ?? []).map((id) =>
    playerSeries(id, s.matchups, (week, playerId) => projectedForWeek(s, week, playerId), {
      starting: starters.has(id),
    }),
  );
}

function myRow(s: AppState, week: number): Matchup | undefined {
  return s.matchups[week]?.find((m) => m.roster_id === myRosterId());
}

function opponentRow(s: AppState, week: number): Matchup | undefined {
  const mine = myRow(s, week);
  if (!mine || mine.matchup_id == null) return undefined;
  return s.matchups[week]?.find(
    (m) => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id,
  );
}

/** Sum of league-scored projections for a team's declared starters. */
function projectedTotal(s: AppState, row: Matchup | undefined): number | null {
  if (!row?.starters) return null;
  let total = 0;
  let found = 0;
  for (const id of row.starters) {
    if (!id || id === "0") continue;
    const p = projected(s, id);
    if (p != null) {
      total += p;
      found++;
    }
  }
  return found === 0 ? null : total;
}

function card(title: string, hint: string, body: string): string {
  if (!body) return "";
  return (
    `<section class="card"><h2>${esc(title)}</h2>` +
    (hint ? `<p class="hint">${esc(hint)}</p>` : "") +
    body +
    `</section>`
  );
}

function empty(headline: string, detail: string): string {
  return `<div class="empty"><strong>${esc(headline)}</strong>${esc(detail)}</div>`;
}

function kickoffNote(s: AppState): string {
  const start = new Date(s.state.season_start_date);
  if (Number.isNaN(start.getTime())) return "Scores appear once games kick off.";
  return `Week 1 kicks off ${start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })}. Scores appear as games go final.`;
}

// --- banners ----------------------------------------------------------------

export function renderBanners(s: AppState): string {
  const out: string[] = [];

  if (!s.reconciliation.agree) {
    out.push(
      `<div class="banner"><h3>Rosters and draft board disagree</h3><p>${esc(
        s.reconciliation.summary,
      )} Rosters shown here are rebuilt from the draft plus transactions.</p></div>`,
    );
  }

  if (s.scoringMismatches.length > 0) {
    const detail = s.scoringMismatches
      .map((m) => `${m.key}: expected ${m.expected}, league has ${m.actual ?? "none"}`)
      .join("; ");
    out.push(
      `<div class="banner is-error"><h3>League scoring has changed</h3><p>${esc(
        detail,
      )}. All points here use the live league settings.</p></div>`,
    );
  }

  if (s.errors.length > 0) {
    out.push(
      `<div class="banner is-error"><h3>Some data didn't load</h3><p>${esc(
        s.errors.join("; "),
      )}. Showing the last cached copy where one exists.</p></div>`,
    );
  }

  if (s.playersProvisional) {
    out.push(
      `<div class="banner"><h3>Building player index</h3><p>Using the shipped player list while the current one downloads. Injury statuses may be a few days old until it finishes.</p></div>`,
    );
  }

  return out.join("");
}

// --- Now --------------------------------------------------------------------

function renderNow(s: AppState): string {
  const week = currentWeek(s);
  const mine = myRow(s, week);
  const opp = opponentRow(s, week);
  const played = playedWeeks(s.matchups);
  const live = (mine?.points ?? 0) > 0 || (opp?.points ?? 0) > 0;

  const myProj = projectedTotal(s, mine);
  const oppProj = projectedTotal(s, opp);

  const scoreOf = (row: Matchup | undefined, proj: number | null) =>
    live ? num(row?.points ?? 0) : proj != null ? num(proj) : "—";

  const matchupCard = card(
    `Week ${week}`,
    live ? "Live scoring" : "Projected, scored under this league's settings",
    `<div class="matchup">
      <div class="matchup-team away">
        <div class="matchup-name">${esc(teamName(s, myRosterId()))}</div>
        <div class="matchup-score">${scoreOf(mine, myProj)}</div>
      </div>
      <div class="matchup-vs">vs</div>
      <div class="matchup-team">
        <div class="matchup-name">${esc(teamName(s, opp?.roster_id))}</div>
        <div class="matchup-score">${scoreOf(opp, oppProj)}</div>
      </div>
    </div>` +
      (!live && myProj != null && oppProj != null
        ? `<p class="hint" style="margin:10px 0 0;text-align:center">${
            myProj >= oppProj
              ? `<span class="good">Favoured by ${esc(num(myProj - oppProj))}</span>`
              : `<span class="bad">Underdog by ${esc(num(oppProj - myProj))}</span>`
          }</p>`
        : "") +
      (!live && myProj == null
        ? `<p class="hint" style="margin:10px 0 0;text-align:center">Projections haven't published for week ${week} yet.</p>`
        : ""),
  );

  // Season summary only means something once games have been played.
  const standings = allPlayStandings(s.matchups);
  const me = standings.find((r) => r.rosterId === myRosterId());
  const summary = me
    ? `<div class="stats">
        <div class="stat"><div class="stat-value">${esc(record(me.actual))}</div><div class="stat-label">Record</div></div>
        <div class="stat"><div class="stat-value">${esc(record(me.allPlay))}</div><div class="stat-label">All-play</div></div>
        <div class="stat"><div class="stat-value ${toneClass(me.luck)}">${esc(signedPct(me.luck))}</div><div class="stat-label">Luck</div></div>
        <div class="stat"><div class="stat-value">${esc(num(me.pointsFor))}</div><div class="stat-label">Points for</div></div>
      </div>`
    : `<div class="card">${empty(
        "The season hasn't started",
        kickoffNote(s),
      )}</div>`;

  const starters = mine?.starters ?? [];
  const startersPoints = mine?.starters_points ?? [];
  const lineupRows = starters
    .map((id, i) => {
      const slot = s.slots[i] ?? "—";
      if (!id || id === "0") {
        return `<tr><td>${posTag(slot)} <span class="faint">empty</span></td><td class="faint">—</td></tr>`;
      }
      const player = s.players[id];
      const proj = projected(s, id);
      const value = live ? num(startersPoints[i] ?? 0) : proj != null ? num(proj) : "—";
      return `<tr>
        <td>${posTag(slot)} ${esc(playerName(s, id))}${injuryTag(player?.injury ?? null)}
          <span class="sub">${esc(player?.pos ?? "")} ${esc(player?.team ?? "FA")}</span></td>
        <td>${esc(value)}</td>
      </tr>`;
    })
    .join("");

  const lineupCard = lineupRows
    ? card(
        "Your lineup",
        live ? "Points scored this week" : "League-scored projections",
        `<table><thead><tr><th>Starter</th><th>${live ? "Pts" : "Proj"}</th></tr></thead><tbody>${lineupRows}</tbody></table>`,
      )
    : card("Your lineup", "", empty("No lineup set", "Sleeper hasn't returned starters for this week yet."));

  // Once there is scoring history, the last few weeks are the fastest read.
  const recent = played.length
    ? card(
        "Recent weeks",
        "Your score against the league each week",
        `<table><thead><tr><th>Wk</th><th>You</th><th>Opp</th><th>Avg</th><th></th></tr></thead><tbody>${trendSeries(
          s.matchups,
          myRosterId(),
        )
          .slice(-5)
          .map((row) => {
            const scores = weekScores(row.week, s.matchups[row.week] ?? []);
            const meWeek = scores.find((x) => x.rosterId === myRosterId());
            const won = meWeek?.won;
            return `<tr>
              <td>${row.week}</td>
              <td>${esc(num(row.points))}</td>
              <td>${esc(num(meWeek?.opponentPoints ?? 0))}</td>
              <td class="faint">${esc(num(row.average))}</td>
              <td class="${won === null ? "faint" : won ? "good" : "bad"}">${
                won === null ? "—" : won ? "W" : meWeek?.tied ? "T" : "L"
              }</td>
            </tr>`;
          })
          .join("")}</tbody></table>`,
      )
    : "";

  return summary + matchupCard + newsCard(s) + lineupCard + recent;
}

/**
 * Availability changes since the last visit.
 *
 * Sleeper has no news feed, but a diff of the player index catches the part
 * that changes decisions: who got ruled out and who was cleared. Yours first,
 * because a ruling on your own starter is the only one you must act on.
 */
function newsCard(s: AppState): string {
  if (s.statusChanges.length === 0) return "";

  const mine = new Set(
    s.rosters.find((r) => r.roster_id === myRosterId())?.players ?? [],
  );
  const rostered = rosteredPlayers(s);
  const trending = new Set(s.trending.map((t) => t.player_id));

  const relevant = s.statusChanges
    .map((change) => ({
      change,
      player: s.players[change.playerId],
      onMyTeam: mine.has(change.playerId),
      available: !rostered.has(change.playerId),
    }))
    // Anyone else's bench player changing status is noise.
    .filter((row) => row.player && (row.onMyTeam || trending.has(row.change.playerId)))
    .sort((a, b) => Number(b.onMyTeam) - Number(a.onMyTeam) || b.change.at - a.change.at)
    .slice(0, 8);

  if (relevant.length === 0) return "";

  return card(
    "Status changes",
    "From the player index, diffed since your last visit",
    `<table><tbody>${relevant
      .map(
        (row) => `<tr${row.onMyTeam ? ' class="is-me"' : ""}>
          <td>${posTag(row.player!.pos)} ${esc(row.player!.name)}
            <span class="sub">${esc(row.player!.team ?? "FA")} · ${
              row.onMyTeam ? "your roster" : row.available ? "free agent" : "rostered"
            }</span></td>
          <td class="status-cell ${row.change.improved ? "good" : "bad"}">${esc(
            describeChange(row.change),
          )}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`,
  );
}

// --- Team -------------------------------------------------------------------

function renderTeam(s: AppState): string {
  const mine = s.rosters.find((r) => r.roster_id === myRosterId());
  const roster = mine?.players ?? [];
  if (roster.length === 0) {
    return card("Your roster", "", empty("No roster yet", "Sleeper hasn't returned your players."));
  }

  const startingSet = startersFor(s, myRosterId());

  const rows = [...roster]
    .map((id) => ({
      id,
      player: s.players[id],
      proj: projected(s, id),
      starting: startingSet.has(id),
    }))
    .sort((a, b) => {
      if (a.starting !== b.starting) return a.starting ? -1 : 1;
      return (b.proj ?? -1) - (a.proj ?? -1);
    });

  const anyProjection = rows.some((r) => r.proj != null);

  const all = rosterSeries(s);
  const chartMax = seriesMax(all);
  const chartWeeks = populatedWeeks(all);
  const seriesById = new Map(all.map((x) => [x.playerId, x]));

  const rosterTable = `<table><thead><tr><th>Player</th><th>Proj</th><th>Season</th></tr></thead><tbody>${rows
    .map((r) => {
      const line = seriesById.get(r.id);
      return `<tr${r.starting ? ' class="is-me"' : ""}>
        <td>${posTag(r.player?.pos ?? null)} ${esc(r.player?.name ?? r.id)}${injuryTag(
          r.player?.injury ?? null,
        )}<span class="sub">${esc(r.player?.team ?? "FA")}${r.starting ? " · starting" : " · bench"}</span></td>
        <td>${r.proj == null ? '<span class="faint">—</span>' : esc(num(r.proj))}</td>
        <td class="spark-cell"><button type="button" class="spark-btn" data-open-chart="${esc(
          r.id,
        )}" aria-label="Season chart for ${esc(r.player?.name ?? r.id)}">${
          line
            ? seasonSpark(line.points, {
                max: chartMax,
                weeks: chartWeeks,
                muted: !r.starting,
              })
            : '<span class="faint">—</span>'
        }</button></td>
      </tr>`;
    })
    .join("")}</tbody></table>`;

  const projectionNote = anyProjection
    ? "Projections recomputed under this league's scoring. Solid is scored, dashed is projected — tap a line for the season chart."
    : "Projections haven't published stat lines for this week yet.";

  // Optimal-lineup preview against projections, before the week is played.
  const projPoints: Record<string, number> = {};
  for (const r of rows) if (r.proj != null) projPoints[r.id] = r.proj;
  const best = anyProjection ? optimalLineup(projPoints, posOf(s), s.slots) : null;
  const declared = startingLineup(s, myRosterId());
  const declaredProj = declared.reduce(
    (sum, id) => sum + (id && id !== "0" ? (projected(s, id) ?? 0) : 0),
    0,
  );

  const lineupAdvice =
    best && best.points - declaredProj > 0.05
      ? card(
          "Lineup check",
          "Best legal lineup from your roster, on projections",
          `<div class="stats">
            <div class="stat"><div class="stat-value">${esc(num(declaredProj))}</div><div class="stat-label">Current</div></div>
            <div class="stat"><div class="stat-value">${esc(num(best.points))}</div><div class="stat-label">Optimal</div></div>
            <div class="stat"><div class="stat-value good">${esc(signed(best.points - declaredProj))}</div><div class="stat-label">Available</div></div>
          </div>
          <table><thead><tr><th>Slot</th><th>Start</th><th>Proj</th></tr></thead><tbody>${best.lineup
            .map(
              (slot) => `<tr${
                slot.playerId && !declared.includes(slot.playerId) ? ' class="is-me"' : ""
              }>
                <td>${posTag(slot.slot)}</td>
                <td>${slot.playerId ? esc(playerName(s, slot.playerId)) : '<span class="faint">—</span>'}</td>
                <td>${esc(num(slot.points))}</td>
              </tr>`,
            )
            .join("")}</tbody></table>`,
        )
      : "";

  const keepers = keeperOptions(myRosterId(), roster, s.draftPicks, s.players);
  const keeperCard = keepers.length
    ? card(
        "Keeper costs for next season",
        "Draft round minus two, escalating annually. Max one keeper.",
        `<table><thead><tr><th>Player</th><th>2026</th><th>2027 cost</th></tr></thead><tbody>${keepers
          .slice(0, 12)
          .map(
            (k) => `<tr>
              <td>${posTag(k.position)} ${esc(k.name)}${
                k.wasKeeper ? '<span class="sub">kept this year</span>' : ""
              }</td>
              <td class="faint">${k.draftedRound ? `R${k.draftedRound}` : "waiver"}</td>
              <td>R${k.nextYearRound}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  const chartButton =
    `<button type="button" class="linkish" data-open-chart="all">` +
    `Season chart — all ${rows.length} players</button>`;

  return (
    lineupAdvice +
    card("Your roster", projectionNote, chartButton + rosterTable) +
    keeperCard
  );
}

/** Series for the season chart, in the shape the chart function wants. */
export function chartSeries(s: AppState): EmphasisSeries[] {
  return rosterSeries(s).map((line) => {
    const pos = s.players[line.playerId]?.pos ?? null;
    return {
      id: line.playerId,
      label: playerName(s, line.playerId),
      emphasis: line.starting,
      points: line.points.map((p) => ({
        ...p,
        edge:
          p.projected == null
            ? null
            : scoringEdge(
                s.projectionsByWeek[p.week]?.[line.playerId]?.stats,
                s.league.scoring_settings,
                pos,
              ),
      })),
    };
  });
}

/**
 * The season chart overlay: every rostered player as a line, starters bright
 * and bench receded, with identity on tap rather than seventeen hues.
 */
export function renderChartModal(
  s: AppState,
  selectedId: string | null,
  horizon: { loading: boolean; loadedThrough: number; filter: "all" | "starters" },
): { html: string; series: EmphasisSeries[]; geometry: ReturnType<typeof emphasisLineChart>["geometry"] } {
  const everyone = chartSeries(s);
  const series =
    horizon.filter === "starters" ? everyone.filter((x) => x.emphasis) : everyone;

  const lines = rosterSeries(s);
  // Scale against the full roster either way, so switching the filter does not
  // silently rescale the axis under the reader.
  const max = seriesMax(lines);
  const weeks = populatedWeeks(lines);
  const { svg, geometry } = emphasisLineChart(series, { weeks, max, selectedId });

  const selected = series.find((x) => x.id === selectedId);
  const starterCount = everyone.filter((x) => x.emphasis).length;

  const legend =
    `<div class="legend">` +
    `<span><i class="swatch" style="background:var(--accent)"></i>Starters (${starterCount})</span>` +
    (horizon.filter === "all"
      ? `<span><i class="swatch" style="background:var(--ink-faint);opacity:.5"></i>Bench (${everyone.length - starterCount})</span>`
      : "") +
    `<span><i class="swatch swatch-dash"></i>Projected</span>` +
    (selected
      ? `<span><i class="swatch" style="background:var(--good)"></i>Selected</span>`
      : "") +
    `</div>`;

  // One filter row, above the chart it scopes.
  const filterRow =
    `<div class="filters">` +
    (["all", "starters"] as const)
      .map(
        (value) =>
          `<button type="button" class="chip${
            horizon.filter === value ? " is-on" : ""
          }" data-chart-filter="${value}">${
            value === "all" ? `All ${everyone.length}` : `Starters only`
          }</button>`,
      )
      .join("") +
    `</div>`;

  // The season normally ships with the build. This is the fallback for when
  // that asset is missing or stale, not the usual path.
  const weeksLoaded = Object.keys(s.projectionsByWeek).length;
  const loadMore =
    weeksLoaded < 3
      ? `<button type="button" class="linkish" data-load-horizon="1"${
          horizon.loading ? " disabled" : ""
        }>${
          horizon.loading
            ? "Loading projections…"
            : "Fetch upcoming projections from Sleeper"
        }</button>`
      : "";

  return {
    html:
      `<div class="sheet-backdrop" data-close-chart="1"></div>` +
      `<div class="sheet" role="dialog" aria-modal="true" aria-label="Season chart">
        <div class="sheet-head">
          <h2>Season by week</h2>
          <button type="button" class="sheet-close" data-close-chart="1" aria-label="Close">×</button>
        </div>
        <p class="hint">Points scored, continuing into projections. Tap a line to identify it.</p>
        ${filterRow}
        <div class="chart-wrap">${svg}</div>
        ${legend}
        <div class="readout" id="chart-readout">${
          selected
            ? ""
            : '<span class="faint">Tap any line for the player and week.</span>'
        }</div>
        ${loadMore}
        <p class="hint" style="margin-top:10px">
          Every value here is also in the roster table behind this panel.
        </p>
      </div>`,
    series,
    geometry,
  };
}

// --- Performance ------------------------------------------------------------

function renderPerformance(s: AppState): string {
  const played = playedWeeks(s.matchups);
  if (played.length === 0) {
    return card(
      "Performance",
      "",
      empty("Your trend line starts after week 1", kickoffNote(s)),
    );
  }

  const series = trendSeries(s.matchups, myRosterId());
  const standings = allPlayStandings(s.matchups);
  const me = standings.find((r) => r.rosterId === myRosterId());

  const trend = card(
    "Score, league average, week high",
    "Where you landed each week against the field",
    lineChart(
      series.map((p) => `W${p.week}`),
      [
        { label: "You", color: "var(--accent)", values: series.map((p) => p.points) },
        {
          label: "League avg",
          color: "var(--ink-faint)",
          values: series.map((p) => p.average),
          dashed: true,
        },
        {
          label: "Week high",
          color: "var(--good)",
          values: series.map((p) => p.high),
          dashed: true,
        },
      ],
      { yLabel: "Weekly scores" },
    ),
  );

  const allPlay = me
    ? card(
        "All-play record",
        "Your score against every team, every week — 9 games a week instead of 1",
        `<div class="stats">
          <div class="stat">
            <div class="stat-value">${esc(record(me.allPlay))}</div>
            <div class="stat-label">All-play</div>
            <div class="stat-note">${esc(pct(me.allPlayPct))} win rate</div>
          </div>
          <div class="stat">
            <div class="stat-value">${esc(record(me.actual))}</div>
            <div class="stat-label">Actual</div>
            <div class="stat-note">${esc(pct(me.actualPct))} win rate</div>
          </div>
          <div class="stat">
            <div class="stat-value ${toneClass(me.luck)}">${esc(signedPct(me.luck))}</div>
            <div class="stat-label">Luck</div>
            <div class="stat-note">${
              me.luck > 0.05
                ? "schedule has helped"
                : me.luck < -0.05
                  ? "schedule has cost you"
                  : "record matches scoring"
            }</div>
          </div>
        </div>`,
      )
    : "";

  const bench = benchReports(s.matchups, myRosterId(), posOf(s), s.slots);
  const totalLeft = bench.reduce((sum, b) => sum + b.left, 0);
  const benchCard = bench.length
    ? card(
        "Points left on the bench",
        "Your lineup against the best one your roster allowed",
        `<div class="stats">
          <div class="stat"><div class="stat-value">${esc(num(totalLeft))}</div><div class="stat-label">Season total</div></div>
          <div class="stat"><div class="stat-value">${esc(num(totalLeft / bench.length))}</div><div class="stat-label">Per week</div></div>
        </div>
        <table><thead><tr><th>Wk</th><th>Started</th><th>Optimal</th><th>Left</th></tr></thead><tbody>${bench
          .map(
            (b) => `<tr>
              <td>${b.week}</td>
              <td>${esc(num(b.actual))}</td>
              <td class="faint">${esc(num(b.optimal))}</td>
              <td class="${b.left > 0.05 ? "bad" : "dim"}">${esc(num(b.left))}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  const edges = positionalEdge(s.matchups, myRosterId(), posOf(s));
  const maxEdge = Math.max(...edges.map((e) => Math.max(e.mine, e.leagueAverage)), 1);
  const positional = edges.length
    ? card(
        "Where your points come from",
        "Per week by position, against the league average at that position",
        `<table><thead><tr><th>Pos</th><th>You</th><th>League</th><th>Edge</th><th></th></tr></thead><tbody>${edges
          .map(
            (e) => `<tr>
              <td>${posTag(e.position)}</td>
              <td>${esc(num(e.mine))}</td>
              <td class="faint">${esc(num(e.leagueAverage))}</td>
              <td class="${toneClass(e.edge)}">${esc(signed(e.edge))}</td>
              <td style="width:52px">${barCell(e.mine, maxEdge, e.edge < 0)}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  const myScores = series.map((p) => p.points);
  const c = consistency(myScores);
  const consistencyCard = card(
    "Consistency",
    "Floor and ceiling are the 20th and 80th percentiles of your weekly scores",
    `<div class="stats">
      <div class="stat"><div class="stat-value">${esc(num(c.mean))}</div><div class="stat-label">Average</div></div>
      <div class="stat"><div class="stat-value">${esc(num(c.stdev))}</div><div class="stat-label">Std dev</div></div>
      <div class="stat"><div class="stat-value">${esc(num(c.floor))}</div><div class="stat-label">Floor</div></div>
      <div class="stat"><div class="stat-value">${esc(num(c.ceiling))}</div><div class="stat-label">Ceiling</div></div>
    </div>
    <p class="hint" style="margin:10px 0 0">${
      myScores.length < 3
        ? "Spread needs a few more weeks to mean much."
        : c.stdev > 25
          ? "High variance — big ceilings, but the floor loses winnable weeks."
          : "Steady week to week."
    }</p>`,
  );

  const strength = opponentStrength(s.matchups, myRosterId());
  const avgRank = mean(strength.map((o) => o.rankLeagueWide).filter((r) => r > 0));
  const scheduleCard = card(
    "Schedule strength",
    "Where each opponent's score ranked league-wide that week",
    `<p class="hint" style="margin:0 0 8px">Average opponent finished ${esc(
      ordinal(Math.round(avgRank)),
    )} of ${s.teams.length} in the week you played them.</p>
    <table><thead><tr><th>Wk</th><th>Opponent</th><th>Scored</th><th>Rank</th></tr></thead><tbody>${strength
      .map(
        (o) => `<tr>
          <td>${o.week}</td>
          <td>${esc(teamName(s, o.opponentRosterId))}</td>
          <td>${esc(num(o.opponentPoints))}</td>
          <td class="${o.rankLeagueWide <= 3 ? "bad" : o.rankLeagueWide >= 8 ? "good" : "dim"}">${esc(
            ordinal(o.rankLeagueWide),
          )}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`,
  );

  return trend + allPlay + benchCard + positional + consistencyCard + scheduleCard;
}

// --- League -----------------------------------------------------------------

function renderLeague(s: AppState): string {
  const played = playedWeeks(s.matchups);
  const standings = allPlayStandings(s.matchups);

  const table = played.length
    ? `<div class="scroll-x"><table><thead><tr><th>Team</th><th>Rec</th><th>All-play</th><th>Luck</th><th>PF</th></tr></thead><tbody>${standings
        .map(
          (r) => `<tr${r.rosterId === myRosterId() ? ' class="is-me"' : ""}>
            <td>${esc(teamName(s, r.rosterId))}</td>
            <td>${esc(record(r.actual))}</td>
            <td>${esc(record(r.allPlay))}<span class="sub">${esc(pct(r.allPlayPct))}</span></td>
            <td class="${toneClass(r.luck)}">${esc(signedPct(r.luck))}</td>
            <td>${esc(num(r.pointsFor))}</td>
          </tr>`,
        )
        .join("")}</tbody></table></div>`
    : `<table><thead><tr><th>Team</th><th>Owner</th><th>FAAB</th></tr></thead><tbody>${s.teams
        .map(
          (t) => `<tr${t.rosterId === myRosterId() ? ' class="is-me"' : ""}>
            <td>${esc(t.name)}</td>
            <td class="faint">${esc(t.owner)}</td>
            <td>$${t.faabRemaining}</td>
          </tr>`,
        )
        .join("")}</tbody></table>`;

  const standingsCard = card(
    played.length ? "Standings" : "League",
    played.length
      ? "All-play is the honest ranking; luck is the gap between it and your record"
      : "Ten teams, half PPR, one keeper each",
    table,
  );

  const mode = waiverMode(s.league.settings);

  const faab =
    mode === "faab"
      ? card(
          "FAAB remaining",
          "Who can still outbid you, and who is broke",
          `<table><thead><tr><th>Team</th><th>Spent</th><th>Left</th><th></th></tr></thead><tbody>${[...s.teams]
            .sort((a, b) => b.faabRemaining - a.faabRemaining)
            .map(
              (t) => `<tr${t.rosterId === myRosterId() ? ' class="is-me"' : ""}>
            <td>${esc(t.name)}</td>
            <td class="faint">$${t.faabUsed}</td>
            <td>$${t.faabRemaining}</td>
            <td style="width:52px">${barCell(t.faabRemaining, 100)}</td>
          </tr>`,
            )
            .join("")}</tbody></table>`,
        )
      : card(
          "Waiver priority",
          describeWaiverMode(mode),
          `<table><thead><tr><th>Order</th><th>Team</th></tr></thead><tbody>${[...s.teams]
            .filter((t) => t.waiverPosition != null)
            .sort((a, b) => (a.waiverPosition ?? 99) - (b.waiverPosition ?? 99))
            .map(
              (t) => `<tr${t.rosterId === myRosterId() ? ' class="is-me"' : ""}>
            <td>${t.waiverPosition}</td>
            <td style="text-align:right">${esc(t.name)}</td>
          </tr>`,
            )
            .join("")}</tbody></table>`,
        );

  const spend = faabHistory(s.transactions).slice(0, 12);
  const spendCard = spend.length
    ? card(
        "Recent waiver claims",
        mode === "faab"
          ? "What things have actually cost in this league"
          : "Who has spent their priority, and on whom",
        `<table><thead><tr><th>Player</th><th>Team</th>${
          mode === "faab" ? "<th>Bid</th>" : "<th>Week</th>"
        }</tr></thead><tbody>${spend
          .map(
            (f) => `<tr>
              <td>${esc(playerName(s, f.playerId))}</td>
              <td class="faint">${esc(teamName(s, f.rosterId))}</td>
              <td>${mode === "faab" ? `$${f.bid}` : f.week}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : card(
        "Recent waiver claims",
        "",
        empty("No claims yet", "FAAB spending appears here once waivers start running."),
      );

  // Before this season has any results, last year's finish is the only real
  // signal about who is good.
  const prev = s.prevSeason;
  const prevCard = prev?.teams.length
    ? card(
        `${prev.season} final standings`,
        played.length ? "How the league finished last season" : "Until this season has results, this is what there is to go on",
        `<table><thead><tr><th>Team</th><th>Rec</th><th>PF</th></tr></thead><tbody>${[...prev.teams]
          .sort(
            (a, b) =>
              b.wins - a.wins || b.pointsFor - a.pointsFor,
          )
          .map(
            (t, i) => `<tr${t.owner === mineOwner(s) ? ' class="is-me"' : ""}>
              <td><span class="faint">${i + 1}.</span> ${esc(t.name)}
                <span class="sub">${esc(t.owner)}</span></td>
              <td>${esc(record({ wins: t.wins, losses: t.losses, ties: t.ties }))}</td>
              <td>${esc(num(t.pointsFor, 0))}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  return standingsCard + prevCard + faab + spendCard;
}

// --- Waivers ----------------------------------------------------------------

function renderWaivers(s: AppState): string {
  const taken = rosteredPlayers(s);
  const available = freeAgents(s.players, taken);
  const trendingCount = new Map(s.trending.map((t) => [t.player_id, t.count]));

  /**
   * Points over replacement: a player's league-scored projection minus the
   * median projection of rostered starters at the same position. This is what
   * makes the ranking specific to this league rather than generic.
   */
  const startersByPos = new Map<string, number[]>();
  for (const roster of s.rosters) {
    for (const id of startersFor(s, roster.roster_id)) {
      if (!id || id === "0") continue;
      const pos = s.players[id]?.pos;
      const p = projected(s, id);
      if (!pos || p == null) continue;
      const list = startersByPos.get(pos) ?? [];
      list.push(p);
      startersByPos.set(pos, list);
    }
  }
  const replacement = new Map<string, number>();
  for (const [pos, values] of startersByPos) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    replacement.set(
      pos,
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0),
    );
  }

  const ranked = available
    .map((p) => {
      const proj = projected(s, p.id);
      const repl = replacement.get(p.pos);
      return {
        player: p,
        proj,
        por: proj != null && repl != null ? proj - repl : null,
        trending: trendingCount.get(p.id) ?? 0,
      };
    })
    .filter((r) => r.proj != null || r.trending > 0)
    .sort((a, b) => (b.por ?? -999) - (a.por ?? -999) || b.trending - a.trending);

  // Roster need, from the performance module — a WR4 upgrade is noise if the
  // TE slot is what's costing games.
  const edges = positionalEdge(s.matchups, myRosterId(), posOf(s));
  const weakest = edges.filter((e) => e.edge < 0).slice(-2).map((e) => e.position);

  const mine = s.teams.find((t) => t.rosterId === myRosterId());
  const myRoster = s.rosters.find((r) => r.roster_id === myRosterId());

  /**
   * A starting slot with nobody eligible to fill it outranks any upgrade. In a
   * 10-team league this is usually a bye week or a dropped defense.
   */
  const held = new Set(myRoster?.players ?? []);
  const heldPositions = new Map<string, number>();
  for (const id of held) {
    const pos = s.players[id]?.pos;
    if (pos) heldPositions.set(pos, (heldPositions.get(pos) ?? 0) + 1);
  }
  const holes = [...new Set(s.slots)]
    .filter((slot) => slot !== "FLEX")
    .filter((slot) => {
      const need = s.slots.filter((x) => x === slot).length;
      return (heldPositions.get(slot) ?? 0) < need;
    });

  const holesCard = holes.length
    ? card(
        "Unfilled starting slots",
        "You cannot field a legal lineup without these",
        `<table><tbody>${holes
          .map((slot) => {
            const best = ranked.filter((r) => r.player.pos === slot).slice(0, 2);
            return `<tr>
              <td>${posTag(slot)} <span class="bad">no ${esc(slot)} rostered</span>
                <span class="sub">best available: ${
                  best.length
                    ? best.map((b) => `${esc(b.player.name)} (${esc(num(b.proj ?? 0))})`).join(", ")
                    : "none projected"
                }</span></td>
            </tr>`;
          })
          .join("")}</tbody></table>`,
      )
    : "";

  /**
   * Points over replacement is only comparable within a position: a kicker
   * clearing his replacement by a point is not worth what a receiver clearing
   * his by a point is. So targets are grouped by position rather than thrown
   * into one ranking, and the streaming positions are kept separate.
   */
  const SKILL = ["QB", "RB", "WR", "TE"];
  const skillGroups = SKILL.map((pos) => ({
    pos,
    rows: ranked.filter((r) => r.player.pos === pos).slice(0, 4),
    needed: weakest.includes(pos) || holes.includes(pos),
  })).filter((g) => g.rows.length > 0);

  const needNote = weakest.length
    ? `Your weakest slots so far: ${weakest.join(" and ")}. Upgrades there are worth more than raw value elsewhere.`
    : "Points over replacement is measured against the median rostered starter at each position, under this league's scoring.";

  const targets = skillGroups.length
    ? card(
        "Best available",
        needNote,
        skillGroups
          .map(
            (g) =>
              `<table><thead><tr><th>${esc(g.pos)}${
                g.needed ? ' <span class="bad">need</span>' : ""
              }</th><th>Proj</th><th>POR</th><th>Adds</th></tr></thead><tbody>${g.rows
                .map(
                  (r) => {
                    // The projection says how good he is; the depth chart says
                    // whether he will play. A backup is noise until the man
                    // ahead is out.
                    const depth = describeDepth(depthChartContext(s.players, r.player.id));
                    return `<tr${g.needed ? ' class="is-me"' : ""}>
                    <td>${esc(r.player.name)}${injuryTag(r.player.injury)}
                      <span class="sub">${esc(r.player.team ?? "FA")}${
                        depth ? ` · <span class="good">${esc(depth)}</span>` : ""
                      }</span></td>
                    <td>${r.proj == null ? '<span class="faint">—</span>' : esc(num(r.proj))}</td>
                    <td class="${r.por == null ? "faint" : toneClass(r.por)}">${
                      r.por == null ? "—" : esc(signed(r.por))
                    }</td>
                    <td class="faint">${r.trending ? r.trending.toLocaleString() : "—"}</td>
                  </tr>`;
                  },
                )
                .join("")}</tbody></table>`,
          )
          .join('<div style="height:12px"></div>'),
      )
    : card(
        "Best available",
        "",
        empty(
          "Nothing to rank yet",
          "Targets appear once projections publish for the week.",
        ),
      );

  const streamers = ranked
    .filter((r) => r.player.pos === "K" || r.player.pos === "DEF")
    .slice(0, 6);
  const streamerCard = streamers.length
    ? card(
        "Streaming K and DEF",
        "Matchup plays, not roster upgrades — kept apart because a point over replacement here isn't worth one at receiver",
        `<table><thead><tr><th>Player</th><th>Proj</th><th>Adds</th></tr></thead><tbody>${streamers
          .map(
            (r) => `<tr>
              <td>${posTag(r.player.pos)} ${esc(r.player.name)}
                <span class="sub">${esc(r.player.team ?? "FA")}</span></td>
              <td>${esc(num(r.proj ?? 0))}</td>
              <td class="faint">${r.trending ? r.trending.toLocaleString() : "—"}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  const trendingRows = s.trending
    .slice(0, 15)
    .map((t) => ({ p: s.players[t.player_id], count: t.count, taken: taken.has(t.player_id) }))
    .filter((r) => r.p);

  const trendingCard = trendingRows.length
    ? card(
        "Trending adds",
        "Site-wide over the last 24 hours — a proxy for news breaking",
        `<table><thead><tr><th>Player</th><th>Adds</th><th></th></tr></thead><tbody>${trendingRows
          .map(
            (r) => `<tr>
              <td>${posTag(r.p!.pos)} ${esc(r.p!.name)}${injuryTag(r.p!.injury)}
                <span class="sub">${esc(r.p!.team ?? "FA")}</span></td>
              <td>${r.count.toLocaleString()}</td>
              <td class="${r.taken ? "faint" : "good"}">${r.taken ? "rostered" : "free"}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`,
      )
    : "";

  const mode = waiverMode(s.league.settings);
  const ahead = s.teams.filter(
    (t) =>
      t.waiverPosition != null &&
      mine?.waiverPosition != null &&
      t.waiverPosition < mine.waiverPosition,
  );

  const budget = !mine
    ? ""
    : mode === "faab"
      ? card(
          "Your budget",
          "FAAB clears Tuesday, two-day process",
          `<div class="stats">
          <div class="stat"><div class="stat-value">$${mine.faabRemaining}</div><div class="stat-label">Remaining</div></div>
          <div class="stat"><div class="stat-value">$${mine.faabUsed}</div><div class="stat-label">Spent</div></div>
          <div class="stat"><div class="stat-value">${
            s.teams.filter((t) => t.faabRemaining > mine.faabRemaining).length + 1
          }</div><div class="stat-label">Rank</div></div>
        </div>`,
        )
      : card(
          "Your waiver priority",
          "Claims clear Tuesday, two-day process",
          `<div class="stats">
          <div class="stat">
            <div class="stat-value">${mine.waiverPosition ?? "—"}</div>
            <div class="stat-label">Priority</div>
            <div class="stat-note">of ${s.teams.length}</div>
          </div>
          <div class="stat">
            <div class="stat-value">${ahead.length}</div>
            <div class="stat-label">Ahead of you</div>
            <div class="stat-note">${
              ahead.length === 0 ? "you win any claim" : "can take a player first"
            }</div>
          </div>
        </div>
        <p class="hint" style="margin:10px 0 0">${
          (mine.waiverPosition ?? 99) <= 3
            ? "High priority is a one-shot resource: a successful claim sends you to the back of the queue. Worth spending on someone who starts, not a bench flier."
            : "Low priority means contested players will be gone. Target names the teams above you do not need."
        }</p>`,
        );

  return budget + holesCard + targets + streamerCard + trendingCard;
}

// --- dispatcher -------------------------------------------------------------

export function renderView(tab: Tab, s: AppState): string {
  const body =
    tab === "now"
      ? renderNow(s)
      : tab === "team"
        ? renderTeam(s)
        : tab === "performance"
          ? renderPerformance(s)
          : tab === "league"
            ? renderLeague(s)
            : renderWaivers(s);

  return renderBanners(s) + body;
}

export function renderSubtitle(s: AppState): string {
  const played = playedWeeks(s.matchups);
  const week = currentWeek(s);
  const scope =
    played.length === 0
      ? `Week ${week} · preseason`
      : `Week ${week} · ${played.length} played`;
  return `${s.league.name} · ${scope}`;
}

/** Exposed for the sparkline in the header on wider screens. */
export function seasonSparkline(s: AppState): string {
  const series = trendSeries(s.matchups, myRosterId()).map((p) => p.points);
  return series.length > 1 ? sparkline(series) : "";
}

/** Flex-eligible positions, re-exported so views elsewhere stay consistent. */
export const FLEX = FLEX_ELIGIBLE;
