# Auto-SBC Studio

**Build SBC squads with your club and priced concepts. Complete a protected queue or your daily upgrades from the EA Web App.**

Auto-SBC Studio is an English-language private beta with a Chrome extension, a local dashboard and a Python constraint solver. It builds on [Oğuzhan Özdemir’s Auto-SBC fork](https://github.com/oguzhanozfe/Auto-SBC) and the [MIT-licensed original by titiroMonkey](https://github.com/titiroMonkey/Auto-SBC). Market-aware costs and concept workflows are implemented independently; SBC Monkey’s paid service and proprietary code are not used.

## Get started

1. Extract the Studio package. On macOS, double-click **Start Studio.command** and keep its Terminal window open. First launch prepares the project environment and installs pinned dependencies from PyPI.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension` inside the package.
3. Open the [EA FC Web App](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/), sign in, and open **Auto-SBC Studio**. Choose the correct season and market, then **Load SBCs**.
4. Choose a challenge, review **Card rules**, and select **Solve and preview**. Inspect the cards and use **Apply squad** to save your reviewed squad.

The dashboard is available at **http://127.0.0.1:8000**. Its sample players let you try a solution without connecting an EA account. Python 3.12+ is required; Node 22+ is needed only to rebuild browser artifacts. Use either the extension or the generated userscript, with the previous Auto-SBC disabled. Paletools may remain enabled.

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

The current release uses a local service. Your club payload is processed in memory on your computer; EA credentials and account actions stay in the Web App. See [Privacy](PRIVACY.md).

Live FC 26 evidence includes ten earlier Daily Silver solve/Apply flows and native concept placement using a current EA price. The newer automatic queue has completed **nine parts**. Across the selected five-set test, progress is **2/5 sets and 12/17 parts**, including 10x85+ and the complete 98+ FOF/FUTTIES pick. The latest queue stopped on a 409 response at Yan Diomandé; that submission is not counted as completed. The new daily preset still needs a full account-level run. Full evidence and limits are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

FC 27 catalog metadata is available, but usable prices and live Web App compatibility are separate checks. FC 26 prices are never substituted for FC 27. Combined same-player conditions, OR expressions and unsupported chemistry profiles remain launch gates; see [QUALITY-PLAN.md](docs/QUALITY-PLAN.md).

## Database and hosting

The public FUT.GG catalog and versioned price snapshots are cached separately by season and platform. The dashboard shows source age, coverage and refresh status.

```sh
.venv/bin/python scripts/sync_catalog.py --game-year 26 --max-pages 1000
.venv/bin/python scripts/sync_catalog.py --game-year 27 --max-pages 1000
.venv/bin/python scripts/sync_catalog.py --game-year 26 --prices-only
```

Add `--platform pc` for the PC market. Dashboard refresh handles ten pages per run and resumes. A fetch timestamp never makes an old price current; snapshot quotes expire after six hours by default, and live EA quotes after two minutes.

Remote hosting is possible. The [hosting evaluation](docs/HOSTING.md) compares free offers, measured solver memory and the changes needed for a hosted beta. The current unauthenticated local service is not ready to expose publicly. No cloud deployment has been performed.

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

Browser files are generated from `frontend/`; edit source modules instead of generated scripts. `VERSION` supplies the release number. CI tests the solver, catalog, API and browser adapter, then builds downloadable browser artifacts. Mocks are distinct from live account evidence. The old scripts are preserved under `legacy/` and are not part of startup.

Product journeys and release gates: [PRODUCT.md](docs/PRODUCT.md). Architecture and test evidence: [VERIFICATION.md](docs/VERIFICATION.md).

## Attribution

- [Original Auto-SBC](https://github.com/titiroMonkey/Auto-SBC), MIT
- [SBC Monkey’s public product description](https://www.sbcmonkey.com/)
- [Paletools](https://pale.tools/fifa/paletools.html)
- [FUT.GG public catalog](https://www.fut.gg/players/)

Unofficial community software, unaffiliated with EA, SBC Monkey or Paletools. MIT applies to repository code; provider data and EA assets retain their own rights. Public catalog snapshots are not committed to Git.
