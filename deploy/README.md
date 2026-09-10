# Render free evaluation

This directory prepares the Python/OR-Tools service for a single-owner hosted
evaluation. It is not a deployment record or a production-capacity claim. No
account has been created, no payment method added, and no EA data uploaded.

## What is deployable

`render.yaml` creates one Docker web service with **plan: free**, no paid disk,
database, background worker or automatic deploys. Render currently lists
**512 MB RAM and 0.1 CPU** for that plan. The Docker entry point binds the
provided port on `0.0.0.0`, with one web process and one OR-Tools worker.
[Blueprint specification](https://render.com/docs/blueprint-spec),
[web service binding](https://render.com/docs/web-services)

Free instances sleep after 15 idle minutes and can take roughly a minute to
wake. Disk and in-memory jobs disappear on restart or sleep. The workspace gets
750 free instance hours monthly; bandwidth/build allowances are shared. Without
a payment method, exhausted allowances suspend services or builds rather than
charge. Do not add a payment method or upgrade as part of this evaluation.
Render warns that free instances are unsuitable for production.
[Free service limits](https://render.com/docs/free)

The current callable Sites service accepts Workers-compatible JavaScript output;
it does not run this native Python/OR-Tools Docker service. A static landing page
would not replace the solver. No Render connector, CLI, or authenticated Render
account is available to this task, and Docker is not installed locally. These
are deployment/build blockers, not reasons to pretend a hosted solver exists.

## Configuration and privacy

| Setting | Behavior |
| --- | --- |
| `AUTOSBC_HOSTED=1` | Explicit opt-in; the ordinary local launcher stays local |
| `AUTOSBC_PUBLIC_ORIGIN` | One exact HTTPS origin; defaults to Render's trusted `RENDER_EXTERNAL_URL` |
| `AUTOSBC_API_TOKEN` | Required 32–512 URL-safe characters; Render generates the secret; never commit or print it |
| `AUTOSBC_EXTENSION_IDS` | Up to five exact comma-separated Chrome extension IDs; no wildcard extension origin |
| `AUTOSBC_SOLVER_WORKERS=1`, `WEB_CONCURRENCY=1` | One compute worker and one web process; concurrent solves return busy |
| `AUTOSBC_MAX_CHEMISTRY_PLAYERS=200` | Default chemistry input cap, configurable from 11 to 5,000; larger requests fail explicitly |
| `AUTOSBC_DATA_DIR` | Ephemeral catalog directory; Docker defaults to `/tmp/autosbc-data` |

Hosted startup fails if the token or exact origin is missing/invalid. Data,
jobs, logs, catalog and download endpoints require Bearer authentication. Public
health exposes only status, version and mode; authenticated health also supplies
catalog state and supported limits. The HTTPS origin comes from Render's
[documented environment variables](https://render.com/docs/environment-variables).

This is a single-owner service. The owner token gives access to that owner's
jobs; it is not a multi-user account system. Do not share it or expose a public
unauthenticated solver. Access logging is disabled; the application never logs
the token. The build context allowlist excludes local databases, reports, club
exports and secrets. Runtime club inputs/results remain in memory. Results expire
after ten minutes, and a missing hosted job returns 410. Clients must stop on a
lost job and require a new review, never replay EA actions.

The initial profile supports owned squads, including bounded chemistry requests,
with at most 5,000 input cards and a 30-second solver budget. Limits reject the
request without trimming candidates or altering constraints. Concepts and full
remote catalog synchronization are disabled for this evaluation profile.

The two small `public-ratings-fc*.json.gz` seeds contain only public definition
IDs and ratings exported from the existing FUT.GG catalogs. They establish
rating-price fallback groups; they do not claim ownership or complete concept
metadata. Authenticated solves explicitly enable bounded public price refresh
when valuation needs it. Refresh requests contain no club payload and fetch only
the selected season's public manifest, index and price blob. The catalog helper
preserves source age, locking and cooldown; unavailable/stale prices remain a
visible limit. No card-page crawl runs on every wake.

## Reviewed deployment sequence

1. Review the Docker/config/security changes and run the tests. Use an existing
   Render account only. If signup, terms acceptance, payment details or a paid
   plan are required, stop and report that exact prerequisite.
2. Select this repository and its reviewed revision in Render's Blueprint flow.
   Inspect the proposal: **one free web service**, no additional resources.
   Enter the extension ID shown in Chrome. The Blueprint generates the token;
   retrieve it privately from service settings without pasting it into reports.
3. After root review, deploy that revision and record the actual HTTPS origin.
   A successful build/health check is not yet a solver-capacity test. The owner
   configures that exact origin and secret in the extension's protected options.
4. Run `deploy/smoke.py` against the deployed origin with `AUTOSBC_API_TOKEN` in
   the process environment. It sends only synthetic rating and real-shaped
   31-chemistry inputs, checks authentication and polls results without retries
   that recreate a lost job. It does not access EA or send any club export.
5. Inspect actual service memory and solve timing, then test sleep/wake and a
   lost-job response. Preserve browser receipts across failure. Only after those
   checks should a separately authorized private account payload be considered.

```sh
.venv/bin/python -m pytest -q tests/test_hosting.py tests/test_api.py
docker build -t auto-sbc-studio:review .
# After an approved deployment; the secret belongs in the environment, not here:
.venv/bin/python deploy/smoke.py https://YOUR-EXACT-SERVICE.onrender.com
```

The Docker command has not been executed in the current environment. Public
source constraints and synthetic API tests do not measure Render performance.
The large Pre-Season experiment does not rule out small chemistry requests; the
default 200-card cap is an evaluation boundary, not a measured memory guarantee.
See [the hosting measurements](../docs/HOSTING.md) for actual request evidence.

To update a public rating seed, use `export_rating_seed.py` with the public-only
catalog and explicit season. The exporter selects only `definition_id,rating`;
it never copies SQLite pages or arbitrary payload columns into the build.
