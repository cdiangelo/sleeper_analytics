/**
 * Renders every tab against the committed fixture and writes screenshots.
 *
 * Sleeper is unreachable from some sandboxed environments, and even where it
 * is reachable the live API is a moving target. This intercepts every Sleeper
 * request and answers it from fixtures/, so the UI can be checked
 * deterministically — including the preseason empty state, which is what the
 * app actually shows until week 1 goes final.
 *
 *   node scripts/shoot.mjs [--week N] [--empty]
 *
 * --empty forces the zero-score preseason state regardless of the fixture.
 */

import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const FORCE_EMPTY = args.includes("--empty");
const DARK = args.includes("--dark");
/**
 * --weeks N fabricates N played weeks so the season charts can be inspected
 * before the season provides any. The numbers are synthetic and never leave
 * this script; it exists because a chart with one dot per player cannot be
 * reviewed, and week 8 is not something you can wait for.
 */
const SIM_WEEKS = Number(
  (args.find((a) => a.startsWith("--weeks=")) ?? "").split("=")[1] ?? 0,
);
const BASE = process.env.PREVIEW_URL ?? "http://localhost:4173/";
const OUT = path.resolve(process.cwd(), "screenshots");

const snap = JSON.parse(readFileSync("fixtures/league-state.json", "utf8"));
const players = JSON.parse(readFileSync("public/players.json", "utf8"));
const PREV_LEAGUE = "1257104727066292224";

/**
 * Deterministic pseudo-random weekly scores, so a run is reproducible and two
 * screenshots of the same week are comparable.
 */
function seeded(week, id) {
  let h = week * 2654435761;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function simulateWeek(week, rows) {
  return rows.map((row) => {
    const points = {};
    let total = 0;
    for (const id of row.players ?? []) {
      // Centre on the player's own projection so the shape stays plausible.
      const base = 12;
      const value = Math.max(0, base * (0.35 + seeded(week, id) * 1.5));
      points[id] = Math.round(value * 10) / 10;
      if ((row.starters ?? []).includes(id)) total += points[id];
    }
    return {
      ...row,
      points: Math.round(total * 10) / 10,
      players_points: points,
      starters_points: (row.starters ?? []).map((id) => points[id] ?? 0),
    };
  });
}

/** Answer a Sleeper URL from the snapshot. */
function respond(url) {
  const u = new URL(url);
  const p = u.pathname;

  // Advance the reported week too, or the app never asks for the fabricated ones.
  if (p === "/v1/state/nfl") {
    return SIM_WEEKS > 0 ? { ...snap.state, week: SIM_WEEKS } : snap.state;
  }

  // The prior-season league must not fall through to the current one, or the
  // "last season" card renders this year's data as history.
  if (p.includes(`/league/${PREV_LEAGUE}`)) {
    if (!snap.prevSeason) return null;
    if (p.endsWith("/users")) return snap.prevSeason.users;
    if (p.endsWith("/rosters")) return snap.prevSeason.rosters;
    return snap.prevSeason.league;
  }

  if (p.endsWith("/users")) return snap.users;
  if (p.endsWith("/rosters")) return snap.rosters;
  if (/\/league\/[^/]+$/.test(p)) return snap.league;
  if (p.includes("/draft/") && p.endsWith("/picks")) return snap.draftPicks;
  if (p.includes("/trending/")) return snap.trendingAdds;
  if (p === "/v1/players/nfl") return null; // force the shipped-asset path

  const matchup = p.match(/\/matchups\/(\d+)$/);
  if (matchup) {
    const week = Number(matchup[1]);
    const rows = snap.matchups[matchup[1]] ?? snap.matchups[1] ?? [];
    if (FORCE_EMPTY) return rows.map((r) => ({ ...r, points: 0 }));
    if (SIM_WEEKS > 0 && week <= SIM_WEEKS) return simulateWeek(week, rows);
    return snap.matchups[matchup[1]] ?? [];
  }

  const tx = p.match(/\/transactions\/(\d+)$/);
  if (tx) return snap.transactions[tx[1]] ?? [];

  if (p.startsWith("/projections/")) return Object.values(snap.projections);

  return null;
}

// Use the preinstalled browser rather than downloading one; the npm package's
// pinned build may not match what the image ships.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: DARK ? "dark" : "light",
});

await page.route("**://api.sleeper.app/**", async (route) => {
  const body = respond(route.request().url());
  if (body === null) return route.fulfill({ status: 404, body: "not in fixture" });
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});

// The shipped index is served by the preview server, but answer it here too so
// the run does not depend on build output ordering.
await page.route("**/players.json", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(players),
  }),
);

/**
 * The real public/projections.json is produced by the CI dump, which needs
 * network access to Sleeper. Stand in for it here by spreading the fixture's
 * one week of projections across the season with per-week variation, so the
 * season lines can be checked. Synthetic, and never written to disk.
 */
await page.route("**/projections.json", (route) => {
  const scored = new Set(Object.keys(snap.league.scoring_settings));
  const rostered = new Set();
  for (const r of snap.rosters) for (const id of r.players ?? []) rostered.add(id);

  const weeks = {};
  for (let w = 1; w <= 17; w++) {
    const rows = {};
    for (const proj of Object.values(snap.projections)) {
      if (!rostered.has(proj.player_id)) continue;
      const wobble = 0.7 + seeded(w, proj.player_id) * 0.6;
      const slim = {};
      for (const [k, v] of Object.entries(proj.stats ?? {})) {
        if (scored.has(k) && typeof v === "number") slim[k] = v * wobble;
      }
      if (Object.keys(slim).length) rows[proj.player_id] = slim;
    }
    if (Object.keys(rows).length) weeks[w] = rows;
  }

  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ season: snap.state.season, weeks }),
  });
});

const problems = [];
page.on("console", (msg) => {
  // The 404 on /v1/players/nfl is deliberate above, to exercise the
  // shipped-asset cold-start path. Everything else is a real problem.
  const text = msg.text();
  if (msg.type() === "error" && !text.includes("Failed to load resource")) {
    problems.push(`console: ${text}`);
  }
});
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

mkdirSync(OUT, { recursive: true });

const tabs = ["now", "team", "performance", "league", "waivers"];
for (const tab of tabs) {
  await page.goto(`${BASE}#/${tab}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".card, .stats", { timeout: 15_000 });
  await page.waitForTimeout(250);

  const suffix = `${FORCE_EMPTY ? "-empty" : ""}${DARK ? "-dark" : ""}${SIM_WEEKS ? `-w${SIM_WEEKS}` : ""}`;
  await page.screenshot({ path: path.join(OUT, `${tab}${suffix}.png`), fullPage: true });

  // A screen that renders nothing legible is a failure even if it does not throw.
  const text = (await page.locator("main").innerText()).trim();
  console.log(
    `${tab.padEnd(12)} ${String(text.length).padStart(5)} chars  ` +
      `${text.length < 40 ? "<-- SUSPICIOUSLY EMPTY" : "ok"}`,
  );
  if (text.length < 40) problems.push(`${tab}: rendered almost nothing`);

  // Nothing may scroll the page sideways at phone width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) problems.push(`${tab}: horizontal overflow at 390px`);
}

// The season chart lives behind a tap, so it needs its own pass.
await page.goto(`${BASE}#/team`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-open-chart]", { timeout: 15_000 });
await page.click('[data-open-chart="all"]');
await page.waitForSelector(".sheet", { timeout: 5000 });
await page.waitForTimeout(300);

// Exercise nearest-point hit testing. In preseason every player has a single
// week-1 dot near the left edge, so a mid-plot tap correctly selects nothing —
// try a few positions and require only that one of them lands.
const svg = await page.locator(".chart-tap").boundingBox();
let readout = "";
if (svg) {
  for (const [fx, fy] of [
    [0.45, 0.45],
    [0.12, 0.5],
    [0.08, 0.35],
  ]) {
    await page.mouse.click(svg.x + svg.width * fx, svg.y + svg.height * fy);
    await page.waitForTimeout(200);
    readout = (await page.locator("#chart-readout").innerText()).trim();
    if (readout && !readout.startsWith("Tap any line")) break;
  }
}

console.log(`\nchart readout after tap: ${readout || "(empty)"}`);
if (!readout || readout.startsWith("Tap any line")) {
  problems.push("chart: no tap position selected a line");
}

const suffix = `${FORCE_EMPTY ? "-empty" : ""}${DARK ? "-dark" : ""}${SIM_WEEKS ? `-w${SIM_WEEKS}` : ""}`;
await page.screenshot({ path: path.join(OUT, `chart${suffix}.png`) });

await browser.close();

if (problems.length) {
  console.error("\nProblems:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nAll tabs rendered cleanly, no horizontal overflow.");
