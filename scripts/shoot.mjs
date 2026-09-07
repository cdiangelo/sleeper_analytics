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
const BASE = process.env.PREVIEW_URL ?? "http://localhost:4173/sleeper_analytics/";
const OUT = path.resolve(process.cwd(), "screenshots");

const snap = JSON.parse(readFileSync("fixtures/league-state.json", "utf8"));
const players = JSON.parse(readFileSync("public/players.json", "utf8"));
const PREV_LEAGUE = "1257104727066292224";

/** Answer a Sleeper URL from the snapshot. */
function respond(url) {
  const u = new URL(url);
  const p = u.pathname;

  if (p === "/v1/state/nfl") return snap.state;

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
    const rows = snap.matchups[matchup[1]] ?? [];
    return FORCE_EMPTY ? rows.map((r) => ({ ...r, points: 0 })) : rows;
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

  const suffix = `${FORCE_EMPTY ? "-empty" : ""}${DARK ? "-dark" : ""}`;
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

await browser.close();

if (problems.length) {
  console.error("\nProblems:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nAll tabs rendered cleanly, no horizontal overflow.");
