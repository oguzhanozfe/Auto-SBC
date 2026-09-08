# Architecture and verification

This document records the implemented boundaries. Exact final test counts, catalog coverage and packaging hashes are recorded with the delivery report.

## Data path

```text
EA Web App + Paletools saved locks
   -> browser companion snapshot (no inventory moves)
   -> localhost background job
   -> fresh public-market enrichment + selection policy
   -> constraint solver
   -> structured result + slot mapping + diagnostics
   -> user review
   -> re-read live inventory/locks
   -> explicit squad Apply
   -> native EA manual submission
```

The public catalog is a separate path: unauthenticated FUT.GG definition API + versioned public price CDN -> SQLite under `data/`. It is not a copy of the private SBC Monkey database or the user’s club.

## Modules

| Module | Responsibility |
| --- | --- |
| `backend/solver_policy.py` | Normalize identities/flags, hard protection, costs and estimates. |
| `backend/solver_model.py` | Constraint normalization, positional/chemical/rating model, status and slot output. |
| `backend/optimize.py` | Compatibility adapter around the model. |
| `backend/setup.py` | Legacy plus structured solver response contract. |
| `backend/catalog.py` | SQLite, public sync, provenance, freshness, CSV compatibility. |
| `backend/planner.py` | Season-scoped owned + market orchestration, progressive pools, retained quote proofs and coverage. |
| `backend/main.py` | Local API, request bounds, single active solve, expiring jobs, static dashboard. |
| `backend/logger.py` | Bounded in-memory diagnostics. |
| `frontend/policy.js` | Browser-side locks, policy and response validation. |
| `frontend/companion.js` | EA adapter, snapshots, UI and reviewed Apply. |
| `frontend/extension-*.js` | Narrow localhost transport bridge. |
| `frontend/build.mjs` | One-source userscript/extension generation. |

## Checks actually exercised

- Real Python solver through FastAPI: 11-player fixture with rating and chemistry requirements; exact returned ownership IDs; user review required.
- Hard locked-item exclusion making an otherwise full 11-card pool infeasible.
- Overlapping solve requests rejected; asynchronous jobs return results/errors and release the solver lock.
- Origin, host, input size/time and endpoint restrictions; removal of arbitrary relay and implicit club CSV exposure.
- Solver identity/scope/rarity/rating/chemistry/missing-price protections and status regressions.
- Catalog decoding, stale/null/nonmarket values, preservation on provider failure, normalized positions and club ownership separation, bounded/resumed traversal.
- Browser policy and mock adapter: solve makes no writes; explicit Apply is the only save path; changed locks, cancelled previews and unknown IDs block Apply.
- Generated script and service-worker syntax; dashboard JavaScript syntax.
- Actual Chrome local dashboard: synthetic pool loaded, solver run, reviewed 11-card output shown, source prices and catalog search inspected.

These initial checks used synthetic inputs and mocks. The subsequent live verification is recorded below. Provider timestamps and completeness describe the downloaded snapshot, not a promise that prices remain current.

## Live FC26 verification (2026-09-09)

The user installed extension 27.0.1 from commit `3fec1fe`. Auto-SBC solved and
saved ten Daily Silver Upgrade squads containing owned club cards. Each native
exchange and reward claim was verified: lifetime completions 4 to 14, remaining
daily rights 11 to 1. All ten selected cards were normal 65-rated silvers whose
zero games were checked in EA's player bio. Coin balance remained 577,251; no
packs were opened or players purchased. This does not establish automatic
played-history protection or compatibility with every SBC.

A separate concept-enabled run produced Xavier Dziekoński, definition 256953,
with a 200-coin FUT.GG quote dated 2026-09-08T20:48:25Z. Native market search
found no listing at 200 and listings starting at 350. The user clarified that
the test should place the concept directly in the SBC; no purchase completed.
Version 27.0.2 implements that placement using EA concept search and retains
the shopping list. It also adds a separate live EA transfer-search mode. Live
concept placement and search remain pending extension reload.

The market adapter contract was checked against EA's publicly served
`ocompiled.js?_=10821` and `compiled_3.js?_=10821`: quality is bronze/silver/gold;
transfer search uses one-based pages and a 20-item page plus one lookahead item;
Buy Now prices and remaining time come from the auction entity. Searches clear
the transfer-market cache between changed criteria. The Paletools public script
documents `disableOverrides` for read-only price searches; the adapter uses it
without changing Paletools settings. Search performs no bid or purchase call.

Live-mode price observations are kept in the solve request, joined to exact
catalog definitions, limited to two minutes and never persisted as FUT.GG quotes.
Missing live results cannot fall back to a public snapshot. Candidate coverage
is the bounded set of observed listings, not an exhaustive market optimum.

An earlier storage-card Apply returned EA 500; subsequent owned-card saves
succeeded. Storage Apply remains unresolved. After repeated exchanges, opening
the SBC later produced an EA null-squad error; a normal page reload restored
navigation. Neither result is claimed as a general storage or native-cache fix.

## Known limitations

Private EA Web App interfaces and Paletools storage formats can change. Unknown profile semantics are not guessed. The historical team-rating model is explicitly an estimate pending comparison to EA’s current display. Solving time is limited; a timed-out search is not an infeasibility proof. The public concept preview uses a bounded, constraint-aware selection from the local catalog with visible coverage; optimality applies to the supplied supported pool.

No telemetry or automatic inventory dump is enabled. The service retains a bounded recent in-memory diagnostic log and up to five short-lived solve job snapshots. Restarting the service discards those results. Public catalog files persist locally and can be refreshed independently.

## Recorded synthetic performance (2026-09-08)

| Pool and request | Result | Elapsed |
| --- | --- | --- |
| 3,000 cards; rating-only | Proven optimal | 0.106 s |
| 3,000 same-league cards; rating 83, chemistry 33 | Verified feasible; proof not claimed | 5.04 s |
| 1,200 mixed cards; rating 83, chemistry 20 | Proven optimal, selected chemistry 29 | 6.92 s |

These are synthetic developer benchmarks, not timings from the user's club. The final model retains all admissible candidates; a smaller diverse pool supplies only a feasibility warm start. Equal primary-cost squads prefer more chemistry and in-position players.

Supported profiles include standard chemistry and complete supplied type-1 local contributions/full-chemistry flags. Unknown global/type-2 profile semantics remain unsupported. Full catalog normalization accepted all 28,501 downloaded records: 24,250 base cards had supported standard chemistry; 4,251 specials require additional live profile metadata. Public data does not expose EA rarity-group arrays.

## Club + market verification (2026-09-08)

118 Python regressions currently pass, including separate purchase budgets, strict concept price freshness/source/season,9 owned + 2 concept and11 concept-only chemistry squads, expanding an initially infeasible pool, keeping selected quote proofs when later prices change, and unknown metadata/status correctness. Browser-side tests validate every selected concept against server catalog proof and the complete shopping list before exposing a review.

An actual FC26 public-catalog run with an empty club,75 rating requirement and 15 second limit considered 16,168 eligible market concepts, found an 11-card squad with2,500 coin purchase cost, and finished in 15.2 seconds. It was feasible; minimum cost was not proven. Chrome showed the shopping list, card IDs, quantities, separate 5,000 weighted score and 2,500 actual cash spend. FC27 selection showed 20,710 cards and 0 usable prices without a season fallback. No actual purchases or EA actions were performed.

FC27 source manifest: https://r2.fut.gg/27/manifest.json. Console/PC price indexes both had 20,710 entries with no positive market quotes. Source publication 2026-09-03T08:58:19Z; checked 2026-09-08. Public card source totals sum to 20,696 but source responses contain 20,710 unique definitions; the 90–94 band returns 14 cards while declaring total 0. Local status exposes observed and reported totals plus warnings.
