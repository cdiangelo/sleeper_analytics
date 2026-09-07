# Gridiron Gurus

Analytics for a 10-team, half-PPR Sleeper league. Static site, mobile-first,
no backend.

## How it works

Every Sleeper call happens client-side, in your browser. Sleeper's API is
CORS-open and unauthenticated, so the hosted page talks to it directly —
scores are live, with no server in the path and nothing to refresh by hand.

```
browser ──> api.sleeper.app        (live: scores, rosters, transactions)
        └─> players.json (shipped) (cold-start player index, ~500KB)
```

The one thing hosting adds is reach: Sleeper is blocked from some sandboxed
environments, which is why the fixture below is refreshed by CI rather than
from a dev machine.

## Getting started

```sh
npm install
npm run dev        # local dev server
npm test           # 75 unit + fixture tests
npm run typecheck
npm run build      # static output in dist/
```

## What it shows

**Now** — this week's matchup with live scores, or league-scored projections
before kickoff, plus your lineup and recent results.

**Team** — your roster with projections recomputed under this league's
scoring, what each player is worth above generic half PPR, a lineup check
against the best legal lineup, and keeper costs for next season.

**Trends** — score against league average and week high, all-play record,
points left on the bench, positional contribution against the league,
consistency, and schedule strength.

**League** — standings ranked by all-play, FAAB budgets, recent claims.

**Waivers** — unfilled starting slots first, then best available by position
ranked on points over replacement, with K and DEF kept separate.

### All-play record

Your score against every other team, every week — nine games a week instead
of one. The gap between all-play win rate and actual record is the luck
number, and it is the most useful single figure in a league this size.

### League-scored everything

Sleeper's default numbers are generic half PPR. This league pays for 40+ yard
plays and yardage bonuses, which meaningfully favours big-play receivers over
volume types. Scoring weights are read live from the league endpoint and never
hardcoded; `verifyScoring()` checks them against the documented table and
raises a banner if they drift, because the live settings always win the math.

## Data notes

**Rosters can lag the draft.** Sleeper's `/rosters` has been observed serving
the previous season's teams for days after a draft completes. Rosters are
therefore rebuilt from draft picks plus completed transactions replayed in
order, then reconciled against `/rosters`. Disagreements surface as a banner
rather than being silently resolved.

**Freshness is displayed, not implied.** Every cached value carries the time
it was fetched, and the header shows it. During games a 30-second-old score
and a 20-minute-old one are different facts.

**Empty states are the normal state early on.** Sleeper returns fully formed
matchup rows with zeroed points well before kickoff, so row presence is never
read as a result.

## Fixture and CI

`fixtures/league-state.json` is a full league snapshot, `public/players.json`
is the trimmed player index, and `public/projections.json` is the whole
season's projections — both of the latter ship with the build.

Season projections are the interesting one. Fetching them live is hopeless: a
single week is ~2MB and the season is ~34MB, far too much for a phone. But
only rostered players are ever plotted and only stat keys this league scores
affect the math, so trimming on both axes leaves ~29KB a week — about 0.5MB
for the season. The CI runner pays the 34MB once a week so the client doesn't.
Both are refreshed by `.github/workflows/refresh-fixture.yml` — on a Tuesday
cron, on changes to the fetch layer, or on manual dispatch.

The fixture backs `tests/fixture.test.ts`, which verifies the app against
known truths: a complete 17-round draft, the ten league keepers at their
documented rounds, Derrick Henry at round 1 slot 9, all 46 scoring weights,
and that roster reconstruction reconciles cleanly.

To regenerate locally (needs network access to `api.sleeper.app`):

```sh
npm run dump
```

To check the UI against the fixture without touching the network:

```sh
npm run build && npx vite preview --port 4173 &
node scripts/shoot.mjs           # screenshots every tab
node scripts/shoot.mjs --empty   # forces the preseason zero-score state
```

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push.

**One-time setup:** go to **Settings → Pages** and set **Source** to
**GitHub Actions**, then re-run the workflow. The workflow asks to enable
Pages itself, but the Actions token is not a repository admin, so that call
comes back `Resource not accessible by integration` until the setting is
flipped by hand once. Everything after that is automatic.

The **Source** dropdown is the part that matters, and it is not the same as
making the repository public. Left on the default *Deploy from a branch*,
Pages serves the repository root — which means this `index.html` with its
`<script src="/src/main.ts">` pointing at TypeScript no browser can run. The
result is an unstyled page stuck on "Loading league…" while every Actions
deploy quietly fails. The boot guard in `index.html` now names that failure
rather than spinning forever.

Assets build with a relative base, so the output runs from a project-site
subdirectory, a user site at the root, a custom domain, or `vite preview`
without reconfiguration.

The site is served from `/sleeper_analytics/`; override with `BASE_PATH` for a
custom domain. Add it to your home screen from Safari for the standalone app
experience — the manifest and icons are already wired up.
