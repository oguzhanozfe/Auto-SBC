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
   -> individual user review OR explicit finite-queue start
   -> re-read live inventory/locks
   -> guarded squad Apply
   -> individual native submission OR guarded batch submission
   -> verify exact receipt and rewards before advancing a batch
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
| `frontend/batch-policy.js` | Finite set/part state, mandatory owned-card protection and effect receipts. |
| `frontend/batch-runner.js` | Solve/save/submit/reward sequencing, stop checks and no automatic write retries. |
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
- Browser policy and mock adapter: solve makes no writes; individual Apply and explicit batches share the guarded save path; changed locks, cancelled previews and unknown IDs block Apply.
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

Version 27.0.4 adds a default-on Companion gate for EA-reported played cards.
It reads the same native getters as Player Bio, rejects positive or unreadable
counts, and rechecks fresh inventory before Apply. Preview rows show the count.
The backend enforces `protectPlayed` when supplied; its legacy API default stays
off for older uploaded inventories without those fields. EA can initialize absent
raw stats arrays to zero, so this follows EA Bio's authority and does not prove
raw payload presence. The 11-player live run below verified that the Companion
protection was enabled and every selected row showed zero matches.

The first 11-player 10x 85+ request also exposed EA's `count=-1` sentinel on a
squad-wide TEAM_RATING condition (minimum 84). Version 27.0.4 normalizes that
sentinel only for verified squad-wide keys. Counted player/group rules still
reject negative counts; the accompanying rarity-group 83 minimum of one remains
enforced. The regression fixture contains these constraints without club data.

In the subsequent live 27.0.4 run, Auto-SBC solved and applied 10x 85+
(challenge 3874) using ten SBC-storage cards and one normal club card. The
"Oynanmış kartları koru" checkbox was on and all eleven preview rows showed
"Maç = 0". Native EA displayed squad rating 84 with all three requirements
satisfied (3/3). Exchange, Claim Rewards, and the confirmation that the pack
was sent to My Packs were verified. The pack remained unopened and the coin
balance remained 577,251.

Two 91-rated parts of the 98+ FOF/FUTTIES Pick subsequently completed through
Auto-SBC solve/Apply followed by native submission. The current five-group task
therefore stands at **1/5 groups and 3/17 segments**: 10x 85+ is complete and the
pick has 2/7 parts complete. Its other five parts, Yan Diomande, Provisions, and
Ultimate Rewind remain pending. These completions predate the new batch runner.
The successful storage-containing save is evidence for that run, not proof that
every storage Apply is reliable.

A separate concept-enabled run produced Xavier Dziekoński, definition 256953,
with a 200-coin FUT.GG quote dated 2026-09-08T20:48:25Z. Native market search
found no listing at 200 and listings starting at 350. The user clarified that
the test should place the concept directly in the SBC; no purchase completed.
Version 27.0.2 implements that placement using EA concept search and retains
the shopping list. It also adds a separate live EA transfer-search mode.

At 2026-09-09T08:58:29.760Z, the live EA mode actually read two search responses
and 21 distinct quotes, with a final Buy Now ceiling of 200 coins. It selected
Bertuğ Yıldırım, rating 69, definition 50599553 / asset 267905, at 200 coins for
Daily Silver Upgrade. The preview identified EA Transfer Market as its source.
Apply then stopped at its concept identity guard before changing the squad.
That 27.0.2 run confirmed live price search but did not confirm native concept save.
Balance remained 577,251 and the SBC remained empty, with one daily right.

Version 27.0.3 separates EA's full `definitionId` (the exact card revision) from
`databaseId` (the athlete identity). EA's public `UTItemEntity` getter computes
the latter using `ItemIdMask.DATABASE`; `PlayerMeta.id` can instead identify the
full revision. The concept guard still requires the exact definition, athlete,
concept entity, rating and rarity. Mismatches now identify the failed public
card fields in the UI.

The live rerun passed with version 27.0.3, commit `aff5fe4`, at
2026-09-09T09:24:25.793Z. Auto-SBC read two EA search responses containing 17
distinct quotes, with a final Buy Now ceiling of 200 coins. It selected Mason
Toye, rating 65, exact definition 50573901 / athlete 242253, at 200 coins for
Daily Silver Upgrade. The UI confirmed: "Konseptler SBC kadrosuna yerleştirildi.
Coin harcanmadı." Native EA showed the blue 65 ST concept in the challenge's
only open GK slot, with both requirements satisfied (2/2). Player Bio confirmed
Mason Toye, FC Ingolstadt 04, 3. Liga, Silver Common. Exchange and Submit remained
disabled while the concept was present.

Balance before and after this concept-only test was 577,251. No owned cards were
used, no players were purchased and no exchange or reward claim occurred. One
daily right was shown before the test; the concept placement was not another
SBC completion. Temporary demo cost weights were restored to 0.1 / 0.7 / 1 / 2;
the maximum rating remained 74 and the budget 2,000 coins. This run verifies the
live EA price-to-native-concept path for this one-card SBC, without establishing
whole-market optimality or compatibility with every challenge.

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

An earlier storage-card Apply returned EA 500; subsequent owned-card saves and
the 27.0.4 10x 85+ save containing ten storage cards succeeded. Storage Apply
therefore has an observed intermittent failure, not a universal failure or a
verified universal fix; the earlier 500 remains unexplained. After repeated
exchanges, opening the SBC later produced an EA null-squad error; a normal page
reload restored navigation. This is not claimed as a general native-cache fix.

## Explicit batch implementation (27.0.5; live test pending)

The user can explicitly select a finite queue and authorize automatic submission.
The runner snapshots each set's remaining parts, skips completed parts/exhausted
rights, and processes one cycle per selected set. It solves and saves each squad,
rechecks current owned cards and native submission eligibility, submits once,
verifies the receipt and rewards, and then advances. Batch mode requires zero
EA-reported matches, non-evolved owned cards, existing locks and active-squad
protection. It excludes concepts and makes no purchase, pack-opening or
player-pick selection call.

The adapter follows EA's
[native submission controller](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_4.js?_=10821),
[SBC service and response DTO](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_2.js?_=10821),
and [reward controller](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_3.js?_=10821).
EA's successful `submitChallenge` response grants awards. The runner's claim
stage is bookkeeping: it validates granted-award evidence and refreshed completion
counters without another claim request. Exact set/challenge IDs and the returned
`setCompleted` flag matter because repeatable challenge status can reset after a
successful submission.

The local journal records a pending effect before dispatch. Persistence failure
blocks the request; timeout or mismatched evidence halts the queue without retry.
Stop prevents later writes but cannot undo a request already sent. Page reload
never resumes automatically. The local report preserves queue progress and
receipts for reconciliation; it is not a full club-inventory dump.

Mocked policy, runner and adapter integration tests exercise stop during awaited
work, guarded fresh cards, finite repeatables, exact receipts, a failing second
part, persistence failures and prevention of duplicate submission. Final counts
are recorded in the release report. **The 27.0.5 batch itself has not completed a
live account run yet; extension reload and live validation remain pending.** The
current live task count stays at 1/5 groups and 3/17 segments.

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
