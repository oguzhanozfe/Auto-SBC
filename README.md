# Auto-SBC Studio · Club + Market / FC 26–27

A local SBC maker built from [Oğuzhan Özdemir’s Auto-SBC fork](https://github.com/oguzhanozfe/Auto-SBC), originally [titiroMonkey/Auto-SBC](https://github.com/titiroMonkey/Auto-SBC) (MIT). The original solver and EA adapter work retain their attribution. This update independently implements market-aware costs and duplicate preference described publicly by SBC Monkey; it does not use its paid backend or proprietary code.

Its central workflow combines owned cards with purchasable concept cards and produces a priced shopping list, including for an empty club. Reviewed concepts can be placed directly in the EA SBC squad using EA's concept entities. It searches a growing market pool within the time budget, keeps the best verified squad and distinguishes cash spend from the value of owned cards.

The project includes a Python constraint solver, a local Turkish dashboard, a SQLite public player/price catalog, and a browser companion generated as a userscript and Chrome extension. **It prepares a reviewable squad. EA submission stays manual.**

## Start locally

**On this Mac:** double-click `Start Studio.command`. It prepares only the project’s local environment when needed, installs the locked packages from PyPI, and opens the dashboard. Keep its Terminal window open; Ctrl+C stops it. It detects an already-running Studio instead of launching a second copy.

Python 3.12 and Node 22+ are recommended. Node is only needed to build the extension; the userscript is checked in.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
node frontend/build.mjs
./start_server.sh
```

Open **http://127.0.0.1:8000**. The dashboard includes a clearly labeled 22-card synthetic example so you can verify the complete flow without EA login. On Windows, use `.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` after creating/installing the environment with its corresponding Python executable.

Download the userscript from the dashboard’s **Kurulum** page, or load `dist/chrome-extension` as an unpacked Chrome extension. Use only one format. Disable the previous Auto-SBC version to avoid duplicate panels and its old submit hooks. Paletools may remain enabled. Full browser setup and compatibility scope: [frontend/README.md](frontend/README.md).

## Fetch the database

```sh
.venv/bin/python scripts/sync_catalog.py --game-year 26 --max-pages 1000
.venv/bin/python scripts/sync_catalog.py --game-year 27 --max-pages 1000
# Refresh only market quotes, without rescanning cards:
.venv/bin/python scripts/sync_catalog.py --game-year 27 --prices-only
```

The sync downloads versioned public FUT.GG market-price snapshots and a resumable, paced card catalog, splitting rating bands to avoid the provider’s result cap. Source publication time, fetch time, price freshness, coverage and errors are visible in the dashboard and `/api/database/status`. Default platform is **PS5/console**; a separate PC cache can be built with the sync script’s `--platform pc` option. Select the season and console/PC market in either UI. Requests explicitly carry `gameYear` and `platform`; the service keeps independent caches and rejects cross-season/cross-platform labels. `AUTOSBC_GAME_YEAR` and `AUTOSBC_PLATFORM` only change server defaults.

Public catalog cards are concepts, never owned inventory. Missing prices remain unknown. SBC acquisition cost and objective prices are not used as market quotes. Fresh prices from similarly rated **owned** cards may provide a labeled P60 opportunity-cost estimate. **A concept requires a positive, sourced, dated and fresh market quote from its selected season/platform; estimates can never enter a shopping list.** Stale snapshots are excluded from optimizer quotes after six hours by default, including stale prices in imported JSON.

The dashboard refresh button processes ten pages and resumes on the next run. The command above completes a full pass when the provider is available. Nothing logs in to an EA account to fetch the public catalog. The proprietary SBC Monkey database is not available to this project.

As checked on 2026-09-08, the FC27 public catalog has **20,710 cards**, but both console and PC FUT.GG snapshots contain **zero usable market prices**. The database reports `awaiting_market_prices`, so snapshot-based FC27 purchase suggestions remain unavailable. The separate live EA mode requires actual listings from the matching signed-in season. FC26 prices are never substituted. Live FC27 Web App compatibility has not been validated.

## What changed

- Independent cost weights: duplicate untradeable **10%**, other untradeable **70%**, tradeable **100%**, concept **200%** of market value; all configurable.
- Server-side concept retrieval expands through 750 / 2,500 / 6,000 / 12,000 / 20,000 diversified candidates within the solve budget. Coverage and metadata gaps are reported; a small-pool optimum is not a global market optimum.
- **Anlık piyasadan çöz** uses the signed-in EA Web App's transfer search for current bronze, silver or gold listings. Only observed Buy Now quotes enter this mode's concept pool; old FUT.GG prices cannot replace missing live quotes. The local catalog supplies card metadata, while EA supplies the current price. Live quotes expire after two minutes and are not written to the catalog.
- `maxPurchasePrice` limits quoted purchase cost separately from `maxTotalPrice` (owned opportunity value plus purchases). Selected concepts have exact card IDs, quantities, prices, source timestamps and links in `shoppingList`. Apply resolves each concept through EA's concept search and places the exact card in the SBC. This does not buy the player or make a concept eligible for submission.
- Hard nation/team/league/rarity locks from Paletools apply to market cards too.
- Hard item/athlete/definition locks, required players, loan/evolution/special protection, rating and market budgets, and storage-only selection. Duplicate priority never overrides a lock.
- Constraint model supports rarity groups, quality/rating/card counts, league/nation/club requirements, alternative positions and supported chemistry profiles. It never quietly ignores unknown requirements.
- Physical-item and athlete identities stay separate. Multiple versions of one athlete cannot fill a squad together. Rarity-group membership stays intact.
- Time-limited background solve jobs keep the browser responsive. Infeasible, unsupported, feasible and proven optimal outcomes are distinguished. Price remains the primary objective.
- Review and explicit Apply in the Web App; locks and inventory are checked again immediately before applying. No pack, transfer, discard or automatic SBC-submission hooks.
- No external JavaScript/CDN dependencies in the browser companion. Catalog requests go from the local service to public FUT.GG sources. Club data is processed in memory and is not sent to a hosted solving service.
- Bounded diagnostics, localhost binding, allowed origins, one active solve and an expiring in-memory result cache replace the old global file dumps and force-kill shutdown.

## Verify

```sh
.venv/bin/python -m pytest -q
node --test tests/frontend*.cjs
node frontend/build.mjs
node --check tampermonkey-ai-sbc.user.js
node --check backend/static/app.js
```

Tests use synthetic SBCs and a mocked EA adapter. The previous ad hoc tests, debug userscripts and Selenium scraper are preserved under `legacy/`; they assumed missing local files or outdated interfaces and are not part of startup or validation. CI runs the solver/catalog/API and browser tests, then publishes a downloadable browser artifact. The old Windows EXE workflow referenced missing packaging files and was replaced by this reproducible check/build workflow.

## Practical limits

On 2026-09-09, version 27.0.1 completed ten Daily Silver Upgrade solve/Apply flows with the user's owned cards; native exchanges and reward claims were also verified. Each consumed card was a normal 65-rated silver with zero games checked in EA's player bio. The concept preview was verified separately. Version 27.0.2 adds native concept placement; its live validation is pending extension reload. One SBC storage candidate returned EA 500 during Apply and remains unresolved. EA's private Web App APIs can change. The native iOS/Android Companion apps are not modified.

The inherited team-rating correction is modeled with exact integer arithmetic, but EA’s complete current rounding specification is not public; the output labels it as an estimate. Unsupported chemistry calculation types or incomplete card metadata are reported rather than guessed. A time limit is not proof that no solution exists. Large chemistry puzzles may require longer solving time.

There is no multi-SBC global allocation, automatic grind loop, or guaranteed “best solver” claim. The next milestones and acceptance gates are in [docs/PLAN.md](docs/PLAN.md); the architecture and actual verification evidence are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Sources and license

- [Original MIT Auto-SBC](https://github.com/titiroMonkey/Auto-SBC)
- [SBC Monkey’s published behavior and cost weights](https://www.sbcmonkey.com/)
- [SBC Monkey Chrome store listing](https://chromewebstore.google.com/detail/fdkndehkhodnbelfdlnpgnmegjdklkic)
- [Paletools official installation](https://pale.tools/fifa/paletools.html)
- [FUT.GG public FC 26 catalog](https://www.fut.gg/players/)
- [EA chemistry thresholds](https://www.ea.com/ea-originals/news/pitch-notes-fifa-23-fut-chemistry-update)

Unofficial community software, unaffiliated with EA, SBC Monkey or Paletools. MIT applies to this repository’s code; upstream provider data and EA assets retain their respective rights. No public catalog snapshot is committed to Git.
