/**
 * App shell: routing, refresh, and the live polling loop.
 */

import "./styles.css";

// Tells the boot guard in index.html that the bundle actually ran.
(globalThis as { __ggBooted?: boolean }).__ggBooted = true;

import { describeAge } from "./lib/cache.js";
import {
  loadAll,
  loadProjectionHorizon,
  myRosterId,
  refreshLive,
  type AppState,
} from "./app/store.js";
import { nearestPoint, type ChartGeometry, type EmphasisSeries } from "./app/charts.js";
import {
  renderChartModal,
  renderSubtitle,
  renderView,
  type Tab,
} from "./app/views.js";

const TABS: Tab[] = ["now", "team", "performance", "league", "waivers"];
/** Matches the current-week matchup TTL, so a poll always fetches. */
const POLL_MS = 60_000;
/** Between games: slow enough to be free, fast enough that an edit shows up. */
const IDLE_POLL_MS = 5 * 60_000;

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
  if (state.league.status !== "in_season") return;

  const week = Math.max(1, state.state.week);
  const scoring = (state.matchups[week] ?? []).some((r) => (r.points ?? 0) > 0);

  // Fast while points are moving. Otherwise still poll, just gently: lineups
  // and waiver claims change between games too, and a start/sit edit that
  // takes an hour to appear reads as the app being broken.
  const interval = scoring || isGameWindow() ? POLL_MS : IDLE_POLL_MS;

  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void poll();
  }, interval);
}

/**
 * A poll is not a reload. Only scores, lineups and rosters move on this
 * cadence; everything else is refetched by the refresh button.
 */
async function poll() {
  if (!state || loading) return;
  try {
    state = await refreshLive(state);
    paint();
    if (sheetOpen) paintSheet();
  } catch {
    // Keep showing the last good render; the age label tells the story.
    paintFreshness();
  }
}

/** Sunday through Monday night, plus Thursday night — when scores move. */
function isGameWindow(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 1 || day === 4;
}

// --- season chart sheet -----------------------------------------------------

let sheetOpen = false;
let selectedPlayer: string | null = null;
let horizonLoading = false;
let chartFilter: "all" | "starters" = "all";
let chartSeries: EmphasisSeries[] = [];
let chartGeometry: ChartGeometry | null = null;

const sheetHost = document.createElement("div");
document.body.appendChild(sheetHost);

function loadedThrough(): number {
  if (!state) return 0;
  return Math.max(0, ...Object.keys(state.projectionsByWeek).map(Number));
}

function paintSheet() {
  if (!state || !sheetOpen) {
    sheetHost.innerHTML = "";
    return;
  }
  const { html, series, geometry } = renderChartModal(state, selectedPlayer, {
    loading: horizonLoading,
    loadedThrough: loadedThrough(),
    filter: chartFilter,
  });
  sheetHost.innerHTML = html;
  chartSeries = series;
  chartGeometry = geometry;
  if (selectedPlayer) showReadout();
}

function closeSheet() {
  sheetOpen = false;
  selectedPlayer = null;
  sheetHost.innerHTML = "";
}

/**
 * Player names come from Sleeper, so the readout is assembled with textContent
 * rather than by concatenating strings into innerHTML.
 */
function showReadout(week?: number, value?: number, projected?: boolean) {
  const host = document.getElementById("chart-readout");
  const line = chartSeries.find((s) => s.id === selectedPlayer);
  if (!host || !line) return;

  host.textContent = "";
  if (week == null || value == null) {
    const hint = document.createElement("span");
    hint.className = "faint";
    hint.textContent = `${line.label} — tap a point for a week.`;
    host.appendChild(hint);
    return;
  }

  const strong = document.createElement("span");
  strong.className = "readout-value";
  strong.textContent = value.toFixed(1);

  const name = document.createElement("span");
  name.className = "readout-name";
  name.textContent = ` ${line.label} · week ${week} · ${
    projected ? "projected" : "scored"
  }${line.emphasis ? " · starting" : " · bench"}`;

  host.append(strong, name);

  // The half-PPR comparison that used to be a column.
  const edge = line.points.find((p) => p.week === week)?.edge;
  if (typeof edge === "number" && Math.abs(edge) >= 0.05) {
    const bonus = document.createElement("span");
    bonus.className = "sub";
    bonus.textContent = `${edge > 0 ? "+" : "−"}${Math.abs(edge).toFixed(
      1,
    )} vs half PPR from this league's bonuses`;
    host.appendChild(bonus);
  }
}

async function loadHorizon() {
  if (!state || horizonLoading) return;
  const mine = state.rosters.find((r) => r.roster_id === myRosterId());
  const keep = new Set(mine?.players ?? []);
  if (keep.size === 0) return;

  horizonLoading = true;
  paintSheet();
  try {
    const extra = await loadProjectionHorizon(
      state.state.season,
      loadedThrough() + 1,
      keep,
    );
    state = { ...state, projectionsByWeek: { ...state.projectionsByWeek, ...extra } };
    paint();
  } finally {
    horizonLoading = false;
    paintSheet();
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const opener = target.closest<HTMLElement>("[data-open-chart]");
  if (opener) {
    const id = opener.dataset.openChart!;
    selectedPlayer = id === "all" ? null : id;
    sheetOpen = true;
    paintSheet();
    return;
  }

  if (target.closest("[data-close-chart]")) {
    closeSheet();
    return;
  }

  const filterBtn = target.closest<HTMLElement>("[data-chart-filter]");
  if (filterBtn) {
    chartFilter = filterBtn.dataset.chartFilter as "all" | "starters";
    paintSheet();
    return;
  }

  if (target.closest("[data-load-horizon]")) {
    void loadHorizon();
    return;
  }

  // Nearest-point hit testing: the reader only has to be closest to a line,
  // never land on a 2px stroke.
  const svg = target.closest(".chart-tap");
  if (svg && chartGeometry) {
    const rect = svg.getBoundingClientRect();
    const ev = event as MouseEvent;
    const vx = ((ev.clientX - rect.left) / rect.width) * chartGeometry.vbW;
    const vy = ((ev.clientY - rect.top) / rect.height) * chartGeometry.vbH;
    const hit = nearestPoint(chartSeries, chartGeometry, vx, vy);
    if (hit) {
      selectedPlayer = hit.series.id;
      paintSheet();
      showReadout(hit.week, hit.value, hit.projected);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sheetOpen) closeSheet();
});

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
    if (age.ageMs > POLL_MS) void poll();
    else paintFreshness();
  }
});

// Keep the age label honest between fetches.
setInterval(paintFreshness, 10_000);

void load();
