/**
 * App shell: routing, refresh, and the live polling loop.
 */

import "./styles.css";

import { describeAge } from "./lib/cache.js";
import { playedWeeks } from "./lib/metrics.js";
import { loadAll, type AppState } from "./app/store.js";
import { renderSubtitle, renderView, type Tab } from "./app/views.js";

const TABS: Tab[] = ["now", "team", "performance", "league", "waivers"];
/** Matches the current-week matchup TTL, so a poll always fetches. */
const POLL_MS = 60_000;

const view = document.getElementById("view")!;
const subtitle = document.getElementById("subtitle")!;
const freshness = document.getElementById("freshness")!;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;

let state: AppState | null = null;
let tab: Tab = readTab();
let loading = false;
let pollTimer: number | undefined;

function readTab(): Tab {
  const hash = location.hash.replace(/^#\/?/, "") as Tab;
  return TABS.includes(hash) ? hash : "now";
}

function setLoading(on: boolean) {
  loading = on;
  refreshBtn.dataset.loading = on ? "1" : "0";
  if (on) freshness.textContent = "updating";
}

function paintFreshness() {
  if (!state || loading) return;
  const age = describeAge(state.scoresFetchedAt);
  refreshBtn.dataset.freshness = age.freshness;
  freshness.textContent = age.label;
}

function paint() {
  if (!state) return;
  view.innerHTML = renderView(tab, state);
  subtitle.textContent = renderSubtitle(state);
  paintFreshness();

  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
    btn.setAttribute("aria-current", btn.dataset.tab === tab ? "page" : "false");
  }
}

async function load(force = false) {
  if (loading) return;
  setLoading(true);

  try {
    state = await loadAll({
      force,
      // The live player index can land after first paint; re-render with it.
      onPlayerIndex: (players) => {
        if (!state) return;
        state = { ...state, players, playersProvisional: false };
        paint();
      },
    });
    paint();
    schedulePolling();
  } catch (err) {
    view.innerHTML =
      `<div class="banner is-error"><h3>Couldn't reach Sleeper</h3><p>` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `Check your connection and pull to refresh.</p></div>`;
    freshness.textContent = "offline";
    refreshBtn.dataset.freshness = "expired";
  } finally {
    setLoading(false);
    paintFreshness();
  }
}

/**
 * Poll only when it can matter: a week in progress, and the tab actually
 * visible. There is no reason to hit Sleeper every minute in the offseason or
 * from a backgrounded tab.
 */
function schedulePolling() {
  clearInterval(pollTimer);
  if (!state) return;

  const week = Math.max(1, state.state.week);
  const rows = state.matchups[week] ?? [];
  const scoring = rows.some((r) => (r.points ?? 0) > 0);
  const seasonRunning = state.league.status === "in_season";
  // Before kickoff there is nothing to poll for; once a week is scoring, there is.
  if (!seasonRunning || (!scoring && playedWeeks(state.matchups).length === 0 && !isGameWindow())) {
    return;
  }

  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void load(true);
  }, POLL_MS);
}

/** Sunday through Monday night, plus Thursday night — when scores move. */
function isGameWindow(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 1 || day === 4;
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  btn.addEventListener("click", () => {
    const next = btn.dataset.tab as Tab;
    if (!TABS.includes(next) || next === tab) return;
    tab = next;
    location.hash = `#/${next}`;
    paint();
    view.scrollIntoView({ block: "start" });
  });
}

window.addEventListener("hashchange", () => {
  const next = readTab();
  if (next !== tab) {
    tab = next;
    paint();
  }
});

refreshBtn.addEventListener("click", () => void load(true));

document.addEventListener("visibilitychange", () => {
  // Coming back to a backgrounded tab, the score on screen is stale by
  // definition. Refresh rather than showing an old number as if it were live.
  if (document.visibilityState === "visible" && state) {
    const age = describeAge(state.scoresFetchedAt);
    if (age.ageMs > POLL_MS) void load(true);
    else paintFreshness();
  }
});

// Keep the age label honest between fetches.
setInterval(paintFreshness, 10_000);

void load();
