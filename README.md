# Auto-SBC Studio

**Build SBC squads with your club and priced concepts. Complete a protected queue or your daily upgrades from the EA Web App.**

Auto-SBC Studio is an English-language private beta with a Chrome extension, a local dashboard and a Python constraint solver. It builds on [Oğuzhan Özdemir’s Auto-SBC fork](https://github.com/oguzhanozfe/Auto-SBC) and the [MIT-licensed original by titiroMonkey](https://github.com/titiroMonkey/Auto-SBC). Market-aware costs and concept workflows are implemented independently; SBC Monkey’s paid service and proprietary code are not used.

## Get started

1. Extract the Studio package. On macOS, double-click **Start Studio.command** and keep its Terminal window open. First launch prepares the project environment and installs pinned dependencies from PyPI.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension` inside the package.
3. Open the [EA FC Web App](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/), sign in, and open **Auto-SBC Studio**. Choose the correct season and market, then **Load SBCs**.
4. Choose a challenge, review **Card rules**, and select **Solve and preview**. Inspect the cards and use **Apply squad** to save your reviewed squad.

The dashboard is available at **http://127.0.0.1:8000**. Its sample players let you try a solution without connecting an EA account. The service runs on macOS and Linux with Python 3.12+; Node 22+ is needed only to rebuild browser artifacts. Native Windows Python is not supported. Use either the extension or the generated userscript, with the previous Auto-SBC disabled. Paletools may remain enabled.

For platform-specific commands and troubleshooting, see [INSTALL.md](INSTALL.md). For browser behavior and compatibility, see [frontend/README.md](frontend/README.md).

## What you can do

- **Solve with club cards and concepts.** Separate the value of owned cards from coins needed for missing players. Review source-dated prices and an exact shopping list, then place the concepts directly in the SBC.
- **Search current EA listings.** Live market mode uses observed Buy Now prices for bronze, silver or gold cards. Its bounded search reports the pool it actually saw. It does not purchase players.
- **Protect important cards.** Respect item, athlete, definition and Paletools locks. Played-card and evolution protection are required in automatic queues. Other filters control specials, tradeable cards, storage, ratings and budgets.
- **Complete a queue.** Add selected sets and authorize the finite list once. Auto-SBC solves, saves, submits and checks each remaining part. It stops on an uncertain write and records receipts separately from verified completion.
- **Complete dailies.** Build a finite plan from current Bronze, Silver, Common Gold and Rare Gold upgrade rights. The preset protects played, evolution and special cards and uses low-rating limits. It leaves reward packs and player picks unopened.
- **Inspect a stopped run.** Read the report inside the extension or download it. Supported read-only verification checks evidence before allowing a fresh plan. Reloading never resumes submissions automatically.

Concepts need a positive, fresh quote for the selected season and platform. Missing or stale prices remain unavailable. Owned-card estimates cannot become shopping-list prices. The solver distinguishes a feasible squad, a proved optimum within its supplied pool, an unsupported requirement and no solution found within the time budget.

## Current beta status

Version **27.0.14** defaults to the local service, where your club payload is processed in memory on your computer. The Chrome extension also supports an explicitly chosen private HTTPS solver with an owner access token and destination-specific consent. Hosted solving sends selected club-card data to that server; EA credentials and account actions stay in the Web App. The Render deployment is prepared but has not been deployed: account sign-in and hosted validation remain pending. See [Privacy](PRIVACY.md) and [hosting setup](deploy/README.md).

Live FC 26 evidence includes ten earlier Daily Silver solve/Apply flows and native concept placement using a current EA price. Auto-SBC has since completed **23 SBC parts/cycles fully automatically**: 14 selected-set parts and nine Bronze dailies. The latest session added five Bronze dailies, Provisions, Ultimate Rewind and the final two Yan Diomandé parts. All selected work is now verified: **5/5 sets and 17/17 parts**. The two 92-rated Yan squads succeeded with a maximum card rating of 95 and a 25,000-coin card value cap, while played/evolution/saved-squad protections remained enabled.

The latest 53-cycle plan verified two Bronze cycles, then stopped on a 426 list read before the next squad. **51 cycles remain**; the plan is unfinished. Earlier stopped-run recovery preserved successful receipts without replaying submissions. These results do not establish completion of the full daily plan. These live EA actions used 27.0.13; the 27.0.14 extension reload and live walkthrough remain pending. Full evidence and limits are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

FC 27 catalog metadata is available, but usable prices and live Web App compatibility are separate checks. FC 26 prices are never substituted for FC 27. Combined same-player conditions and OR/unknown eligibility operations now stop before solving or account writes. Unsupported chemistry profiles remain excluded with diagnostics; see [QUALITY-PLAN.md](docs/QUALITY-PLAN.md).

## Database and hosting

The public FUT.GG catalog and versioned price snapshots are cached separately by season and platform. The dashboard shows source age, coverage and refresh status.

```sh
.venv/bin/python scripts/sync_catalog.py --game-year 26 --max-pages 1000
.venv/bin/python scripts/sync_catalog.py --game-year 27 --max-pages 1000
.venv/bin/python scripts/sync_catalog.py --game-year 26 --prices-only
```

Add `--platform pc` for the PC market. Dashboard refresh handles ten pages per run and resumes. A fetch timestamp never makes an old price current; snapshot quotes expire after six hours by default, and live EA quotes after two minutes.

Solves can make a bounded public bulk-price refresh when owned-card valuation or catalog concepts need fresh data. That refresh sends no club payload to the price provider. If the player value cap excludes cards with missing or stale prices and the remaining pool cannot solve the challenge, `PRICES_UNAVAILABLE` avoids claiming the full club is infeasible. Prices and protection limits are never silently relaxed.

The opt-in hosted profile authenticates requests, restricts the exact host/origin and runs one solve at a time. It supports owned cards with a 30-second budget, up to 5,000 input cards and a smaller chemistry cap; concepts remain a local feature. [Render setup](deploy/README.md) and the [hosting evaluation](docs/HOSTING.md) describe the free-tier limits and pending smoke tests. Do not expose ordinary unauthenticated local mode publicly. Docker CI smoke and a deployed Render lifecycle test are still pending.

## Development

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
node frontend/build.mjs
./start_server.sh
```

```sh
.venv/bin/python -m pytest -q
node --test tests/frontend*.cjs
node frontend/build.mjs
node --check tampermonkey-ai-sbc.user.js
node --check backend/static/app.js
```

Browser files are generated from `frontend/`; edit source modules instead of generated scripts. `VERSION` supplies the release number. CI tests the solver, catalog, API and browser adapter, then builds downloadable browser artifacts. The added Docker smoke job still needs a successful run for this release. Mocks are distinct from live account evidence. The old scripts are preserved under `legacy/` and are not part of startup.

Product journeys and release gates: [PRODUCT.md](docs/PRODUCT.md). Observed account scenarios and acceptance criteria: [REAL-WORLD-CASES.md](docs/REAL-WORLD-CASES.md). Architecture and test evidence: [VERIFICATION.md](docs/VERIFICATION.md).

## Attribution

- [Original Auto-SBC](https://github.com/titiroMonkey/Auto-SBC), MIT
- [SBC Monkey’s public product description](https://www.sbcmonkey.com/)
- [Paletools](https://pale.tools/fifa/paletools.html)
- [FUT.GG public catalog](https://www.fut.gg/players/)

Unofficial community software, unaffiliated with EA, SBC Monkey or Paletools. MIT applies to repository code; provider data and EA assets retain their own rights. Full public catalog databases are not committed to Git; the Docker profile includes small public definition/rating seeds without club ownership data.
