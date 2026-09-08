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

These checks do not establish correctness against the user’s currently signed-in EA session. No actual SBC submission, market purchase, pack action or account change was performed. Provider timestamps and completeness describe the downloaded snapshot, not a promise that prices remain current.

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
