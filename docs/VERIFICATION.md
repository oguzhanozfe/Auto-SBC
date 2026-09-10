# Architecture and verification

This document records the implemented boundaries. Exact final test counts, catalog coverage and packaging hashes are recorded with the delivery report.

Current release checkpoint: **27.0.14, 10 September 2026**. The selected five-set
request has **5/5 sets and 17/17 parts** verified. Fourteen selected-set parts and
nine Bronze dailies completed automatically: **23 automatic parts/cycles**.
The latest live session added Provisions, Ultimate Rewind, five Bronze dailies
and the final two Yan parts. The selected request is complete; **51 daily cycles remain** after the latest finite plan stopped. Historical entries below retain the earlier version-specific counts
and failures; they are not the current totals. Final test counts and CI status
belong to the release report after all changes settle.

## Data path

```text
EA Web App + Paletools saved locks
   -> browser companion snapshot (no inventory moves)
   -> local background job OR explicitly chosen private HTTPS owner service
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
| `backend/main.py` | Local/opt-in hosted API, request bounds, one active solve, expiring jobs and mode-specific landing pages. |
| `backend/runtime_config.py` | Explicit hosted origin/token configuration, exact extension origins and resource limits. |
| `backend/hosted_seed.py` | Public definition/rating seed only; no club ownership or concept catalog claim. |
| `backend/logger.py` | Bounded in-memory diagnostics. |
| `frontend/policy.js` | Browser-side locks, policy and response validation. |
| `frontend/batch-policy.js` | Finite set/part state, mandatory owned-card protection and effect receipts. |
| `frontend/batch-runner.js` | Solve/save/submit/reward sequencing, stop checks and no automatic write retries. |
| `frontend/companion.js` | EA adapter, snapshots, UI and reviewed Apply. |
| `frontend/extension-*.js` | Local/default or chosen HTTPS transport, extension-owned token settings, exact endpoint allowlist and pinned destination. |
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
saved ten Daily Silver Upgrade squads containing owned club cards. Each of the ten native
exchanges and reward claims was verified. All ten selected cards were normal 65-rated silvers whose
zero games were checked in EA's player bio. No coins were spent, packs opened
or players purchased. This does not establish automatic
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
was sent to My Packs were verified. The pack remained unopened and no coins were spent.

Two 91-rated parts of the 98+ FOF/FUTTIES Pick subsequently completed through
Auto-SBC solve/Apply followed by native submission. At that point, the five-group task
stood at **1/5 groups and 3/17 segments**: 10x 85+ is complete and the
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
No coins were spent and the SBC remained empty; no completion was credited.

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

No coins or owned cards were used, no players were purchased and no exchange
or reward claim occurred. The concept placement was not another SBC completion. Temporary demo cost weights were restored to 0.1 / 0.7 / 1 / 2;
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

## Explicit batch implementation (27.0.5; first live attempt)

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
are recorded in the release report. On 10 September, the live batch started set
1420 / challenge 4116, then stopped on EA 429 while redundantly rereading the set
list before solving. The exported journal contains no save or submit receipts.
After that first attempt, the task count remained at 1/5 groups and 3/17 segments.

## Daily automation and read pacing (27.0.6 implementation checkpoint)

A separate Daily button reads the current finite rights for Daily Bronze, Silver,
Common Gold and Rare Gold Upgrade. Explicitly starting its displayed plan runs
those repetitions in that order, without extending the plan after a reset.
Fresh native counters are checked before each cycle and submission. Daily
profiles protect specials, played/evolved cards, active squads and Paletools
locks; rating ceilings are 64/74/82 and each card value is capped at 1,000 coins
or the user’s lower limit. No concept, purchase, pack opening or pick selection
is part of this flow. The manual policy and selected queue are restored afterward.

The batch reuses its just-read set snapshot for solving. Only requestSets and
requestChallengesForSet can retry after a numeric 429, once, with a cancellable
60-second fallback wait. A usable Retry-After is honored up to five minutes; a
longer delay stops the run. Save, load/init and submit operations never retry.
Separate daily and child journals preserve confirmed cycles and uncertain writes.
The new Daily mode remains unvalidated on the real account until a confirmed run.

The first 27.0.6 live automatic cycle solved, saved and submitted challenge 4116
(90-rated) in set 1420. EA returned the exact success receipt and award pack 302.
The native SBC list then showed 3/7 parts, up from 2/7; no coins were spent.
All eleven selected cards passed the zero-games gate. The immediate post-submit
list refresh returned EA 521, so the queue stopped with claim verification
uncertain and displayed zero fully reconciled parts. The actual task total is
1/5 groups and 4/17 parts. Read-only journal reconciliation was not yet available in that build; the
successful submission must not be repeated.

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

At that historical checkpoint, 118 Python regressions passed, including separate purchase budgets, strict concept price freshness/source/season,9 owned + 2 concept and11 concept-only chemistry squads, expanding an initially infeasible pool, keeping selected quote proofs when later prices change, and unknown metadata/status correctness. Browser-side tests validate every selected concept against server catalog proof and the complete shopping list before exposing a review.

An actual FC26 public-catalog run with an empty club,75 rating requirement and 15 second limit considered 16,168 eligible market concepts, found an 11-card squad with2,500 coin purchase cost, and finished in 15.2 seconds. It was feasible; minimum cost was not proven. Chrome showed the shopping list, card IDs, quantities, separate 5,000 weighted score and 2,500 actual cash spend. FC27 selection showed 20,710 cards and 0 usable prices without a season fallback. No actual purchases or EA actions were performed.

FC27 source manifest: https://r2.fut.gg/27/manifest.json. Console/PC price indexes both had 20,710 entries with no positive market quotes. Source publication 2026-09-03T08:58:19Z; checked 2026-09-08. Public card source totals sum to 20,696 but source responses contain 20,710 unique definitions; the 90–94 band returns 14 cards while declaring total 0. Local status exposes observed and reported totals plus warnings.


## Read-only reconciliation (27.0.7)

The **Son teslimi doğrula** control reads the durable batch report and fresh EA
set/challenge counters. It accepts only one failed claim-verification stage whose
ledger and exact receipt already prove successful submission and granted rewards.
It never saves or submits again. Original receipts and ledger entries remain; a
read-only reconciliation entry is appended. Matching Daily child records update
with pinned journal checks, and interrupted persistence remains blocked.
Completed set cycles leave the manual queue; partial sets remain stopped.

Normal post-submit verification waits two cancellable seconds before its forced
read. This is application pacing, not a documented EA requirement or a proven
explanation for status521. That version did not retry 521. The UI distinguishes
submission receipts from completed counter verification. Recovery currently
supports claim-uncertain reports; submitted, claim-pending, uncertain save/submit
and malformed reports stay blocked. There is no automatic replay after reload.

All 221 browser tests passed, including finite daily rights, cancellation, exact
receipt/counter reconciliation, persistence failures and repeatable queue removal.
The generated extension passed syntax validation. The unchanged backend was
previously validated with 176 tests; current commit CI is recorded separately.

## Automatic account run and English beta (10 September 2026)

Version 27.0.6 automatically saved and submitted challenge 4116 of the 98+
FOF/FUTTIES pick. Its exact EA award receipt was successful, but the following
set-list read returned 521. The 27.0.7 read-only reconciliation verified the
completion counter without resubmitting that squad.

The following 27.0.7 queue run completed eight more parts with matching native
submission receipts and fresh completion counters:

| Set | Completed challenge IDs | Group result |
| --- | --- | --- |
| 98+ FOF/FUTTIES T1–T4 Pick (1420) | 4117, 4118, 4121, 4122 | Complete |
| Yan Diomandé (1427) | 4148, 4149, 4150, 4151 | 4/7 parts complete |

A set-list 429 during the transition used the bounded read retry successfully.
The next Yan Diomandé part, 4152, had a confirmed save followed by a returned 409
from native submit. It has no successful submission receipt and is not counted.
That extension version did not preserve detailed item violations, so the exact
409 cause is unknown. The queue stopped without retrying the write.

Across these runs, **nine parts completed fully automatically**. Including the
three earlier solve/Apply plus native-submit parts, the selected five-set test is
**2/5 sets and 12/17 parts**. All automatic receipts recorded zero-game checks;
no coins were spent and no packs or player picks were opened.
The new daily preset has not yet completed its account-level validation.

Version 27.0.9 makes the companion, dashboard and launcher English, adds an
in-panel report viewer, and retains only bounded, validated saved-squad conflict
names and physical IDs when EA provides those details. A bare 409 is not labeled
as a saved-squad conflict. `VERSION` is shared by the service, launcher and build.
The English dashboard was inspected in a real browser; regression tests use
synthetic fixtures and do not replace live validation.

FC 27 public price snapshots were refreshed again on 10 September at
00:17:46 UTC (console) and 00:17:52 UTC (PC). Both fetched successfully but still
contained zero usable/fresh prices. Their provider publication timestamp remained
3 September, 08:58:19 UTC. The UI correctly reports `awaiting_market_prices`;
fresh retrieval does not make that provider snapshot current. This price-only
check did not scan more catalog pages or access an EA account.

The 27.0.9 read-only no-completion check passed live at
2026-09-10T00:21:29.532Z for Yan Diomandé challenge 4152: all eleven original
physical cards remained owned and both status reads showed no completion. The
report retained its eight previous verified parts and original uncertain event;
no completion credit or submission was added. Its exported record was preserved
before starting a fresh queue.

The fresh 27.0.9 queue stopped before any save/submit on saved-squad identity
validation. Version 27.0.10 separates native squad identifiers from physical card
IDs and adds bounded typed diagnostics; the actual original mismatch is not
attributed without live evidence. Native squad zero is supported while returned
identity must still match exactly. The correction adds five adapter regressions.

## First verified automatic daily (27.0.11)

The 27.0.10 all-saved-squad read passed live. Its first Bronze daily saved a
valid one-player squad, but the pre-submit guard rejected the ten fixed empty
slots because EA gives their null items type `PLAYER`. Native EA showed 2/2
requirements satisfied; no manual exchange was used.

Version 27.0.11 checks the actual fixed-slot layout and native regular-brick
marker, zero physical/definition IDs, nonconcept status and invalid null item.
Unexpected owned cards are rejected even inside a brick. The complete squad is
checked after saving and immediately before dispatch. One-player/ten-brick
Bronze and Silver regressions, malformed placeholders and a final-dispatch
mutation passed; the full suites passed 177 Python and 308 browser tests.

At 2026-09-10T00:34:41.089Z, the extension automatically submitted Bronze daily
3968, with the exact successful receipt and zero-game check. Fresh counters
verified the cycle at 00:34:43 UTC. The daily report records **1/60 cycles
completed**; the next cycle stopped on a returned 521 during its initial set-list
read, before any save or submission. No completion was lost or replayed.

This brings the fully automatic total to **ten SBC parts/cycles**: nine selected
set parts plus one Bronze daily. The separate five-set request remains 2/5 groups
and 12/17 parts. No cards were bought and reward packs remain unopened. One completed daily does not establish full-plan readiness.

The subsequent 27.0.11 selected-set queue completed Yan Diomandé 4152 at
00:48:58.593 UTC with a successful receipt and fresh counter verification.
This was a fresh protected solve after the earlier no-completion proof, not a
replay of the rejected 409 submission. The next part, 4153 (92-rated), returned
UNKNOWN after its 30-second solve budget before any save. The selected-set
total advanced to **2/5 groups and 13/17 parts**; the automatic total reached
**eleven**, comprising ten selected-set parts and the separate Bronze daily.

## Optimizations from observed requests (27.0.12)

The historical 3,000-card all-position chemistry benchmark is a synthetic stress
case. It is not a product acceptance case or sufficient grounds for a hosting
decision. The benchmarking command now requires either an actual exported
request or explicit synthetic mode. It runs the production planner locally and
reports anonymous pool, policy, time and memory aggregates. Four captured
request shapes and their limitations are documented in [HOSTING.md](HOSTING.md).

For 11 players and at least 31 chemistry, even one out-of-position player's zero
would cap the squad at 30. Version 27.0.12 therefore omits impossible assignment
choices only when the requirements prove all players must be in position. It
keeps all candidate identities and constraints, including required cards with
no legal slot. Lower chemistry requirements retain out-of-position choices.
129 solver regressions passed, including comparison against the old assignment
domains and exhaustive small formations. The real Pre-Season 6 replay remained
FEASIBLE with 3,121 candidates: one run measured 2,046.7 MiB peak versus the
earlier 2,817.8 MiB. Both used approximately 30 seconds; neither was an EA save
or submission, and this is not a guaranteed performance or cloud capacity result.

Owned-only Apply and batch pre-write checks now refresh Club ownership for the
reviewed full definition IDs. They clear native caches, validate physical IDs
and full revisions, then refresh Storage and every saved-squad lock. Solve,
concept and no-completion recovery reads remain complete. A filtered ownership
proof is explicitly marked incomplete for the whole Club. Adapter regressions
cover missing/swapped cards, off-filter revisions, cumulative pages, stale squad
hydration, changed locks and Stop. The 27.0.12 one-card Bronze run subsequently
passed all three targeted post-solve checks live. Full Storage and saved-squad
refreshes remained enabled. This establishes the observed native query path,
not every possible club or revision combination.

The allowlisted SBC set/challenge list reads also retry a numeric 521 once with
the same bounded, cancellable cooldown as 429. Mixed failures still permit only
two total attempts. Save, load and submit are outside the retry allowlist. Daily
tests preserve a completed first cycle across a next-cycle transient failure,
repeated failure and Stop during the countdown, without duplicate submissions.

The fresh 27.0.12 daily plan verified **2/59 Bronze cycles**, with successful
receipts at **00:58:52.282Z** and **01:00:13.762Z**. An initial 521 set-list read
before the second cycle recovered after one 60-second retry. Before the next
cycle, the initial set-list read returned 512; its child ledger contains only
`batch-stopped`, with no save or submit. The local export
`autosbc-daily-targeted-521-recovered-2026-09-10.json` preserves both completed
child reports and the blocked cycle.

## Bounded list-error policy and live checkpoint (27.0.13)

Only `requestSets` and `requestChallengesForSet` may retry after a numeric 429
or an integer status from 500 through 599. There is one retry per read operation,
two total attempts even when the error changes. A usable positive Retry-After
is honored up to five minutes; otherwise the fallback is 60 seconds. Stop and
journal/scope guards run throughout the visible countdown. Load, Save and Submit
remain outside this retry path, and stopped runs never resume after reload.

The inspected public EA client gives neither 512 nor 521 a defined error name.
Unknown codes pass through its HTTP conversion and receive a generic error
message. The retry range is application policy, not evidence that these codes
mean temporary overload, authentication, captcha or a restriction. The source
defines separate authentication/captcha and service codes. See EA's
[public client bundle](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/ocompiled.js?_=10821)
and [SBC service/error handling](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_2.js?_=10821).

The fresh 27.0.13 plan had 57 rights and verified **1/57 Bronze cycles**. The
receipt is timestamped **01:08:34.062Z**, counter verification completed at
**01:08:36.413Z**, and the next initial set-list read returned 426 at
**01:08:36.415Z**. Its child has no save or submit attempt. That response is
outside the retry policy; the test stopped without broadening it. The local
report `autosbc-daily-27.0.13-2026-09-10.json` was downloaded and read back.

At that checkpoint there were four verified automatic Bronze dailies and ten automatic
selected-set parts, **14 fully automatic completions**. The original selected
request remains **2/5 sets and 13/17 parts**. Fifty-six daily rights remain by
arithmetic; this is not a fresh rights query. No purchases, pack opening or
pick selection occurred. The complete daily plan
and remaining selected-set work are still pending. Only the 521 list retry was
observed live; the broader 5xx policy, including 512, has unit coverage.

The download lifetime correction also passed twice in Chrome: the native Save
dialog remained available for renaming and saved both actual reports. The first
file was 38,468 bytes. At this release checkpoint, **227 Python and 337 browser
tests passed**. The local launcher check reported no missing packages and a
ready 27.0.13 server; these checks do not establish uninterrupted automation.

The English dashboard also passed a browser smoke check against the connected
27.0.13 service: its clearly labelled 22-player sample produced an 11-player,
84-rating, 33-chemistry squad with zero quoted coins in 0.8 seconds. Setup,
download, privacy and feedback links were visible. This used sample data and
performed no EA account action.

The same actual Pre-Season 6 export also had an offline one-worker experiment:
**587.5 MiB**, **30.251 seconds**, search **UNKNOWN**, and zero solution players.
The planner reported `UNSUPPORTED_CHEMISTRY` with 30 excluded profiles. Concurrent
local service activity could overlap; no controlled speed, successful low-memory
solve or hosted-capacity conclusion follows. See [HOSTING.md](HOSTING.md) for
the workload and limits. Daily and rating-only work remain the immediate priorities.


## Hosted transport, eligibility and price boundaries (27.0.14)

The Chrome extension now defaults to localhost while offering an explicitly
chosen HTTPS owner service. Its options page requires a server address, bearer
token and destination consent before requesting that host permission. The token
stays in extension local storage restricted to trusted extension contexts; it
is not sent to the EA page or included in solve exports. Network requests omit
cookies and reject redirects. A loaded EA page pins the origin and configuration
revision, and fresh checks before Save/Submit reject settings changed since the
preview. The generated userscript remains local-only.

Adapter and transport tests cover local compatibility, consent/permission
failure, missing settings, handshake timeout, incorrect response origins,
settings changes before a private POST, after preview and after Save, plus
Cancel during the fresh settings check. Stop during the new five-second pause
between daily cycles preserves the first receipt and prevents the next list,
solve and write. These are controlled tests, not a deployed-host proof.

The companion rejects combined same-player native requirements, OR and unknown
eligibility operations before sending a solve or performing account writes.
Separate supported AND predicates retain their counts/scopes. The rejection is
explicit unsupported coverage, not implemented OR/intersection solving.

When valuation requires it, the API planner permits a bounded public bulk-price
refresh under catalog locks/cooldown. Provider requests contain no club data.
Source timestamps and protection/value limits remain in force after failure.
If otherwise eligible owned cards lack usable valuation under a player value
cap and the restricted model is infeasible, `PRICES_UNAVAILABLE` preserves that
restricted-pool diagnostic without declaring the full owned club infeasible.

The opt-in hosted service requires bearer authentication for jobs/data and exact
host/origin configuration. Its public health is minimal; authenticated health
exposes catalog state and limits. It runs one web process/solver worker, retains
jobs in memory for ten minutes and returns 410 for a lost result. The limited
profile accepts owned cards, up to 30 seconds and 5,000 input cards, with a
smaller default chemistry cap. Docker packaging contains public definition/rating
seeds and excludes local club exports, private reports and secrets.

Render configuration is prepared, but deployment awaits user sign-in. Docker CI
smoke, deployed synthetic solve tests and sleep/restart validation are pending.
No hosted private club run or cloud capacity result is claimed. The public
hosted landing page directs the owner to the authenticated Chrome extension;
the local dashboard remains available locally.

The latest live account session completed five additional Bronze dailies,
Provisions, Ultimate Rewind and the final two Yan parts through Auto-SBC 27.0.13. Cumulative automatic progress is
**23 parts/cycles: 14 selected-set parts and nine Bronze dailies**. The selected
request is complete at **5/5 sets and 17/17 parts**. The final two 92-rated Yan
squads passed with maximum card rating 95 and card value cap 25,000; played,
evolution and saved-squad protections stayed enabled, with no purchases. The
earlier 94-rating ceiling had prevented a feasible protected squad in that
configuration. The squads were solved sequentially. The latest **53-cycle daily plan** verified two more Bronze cycles, then
stopped on an initial 426 list read before any next-cycle effect. **51 cycles
remain** and the full plan is unfinished. Those figures count verified
submissions/counters, not previews or saved squads. Raw journals, physical card
IDs and account balances remain outside this distributable document.


The final local suites passed **274 Python and 408 browser tests**. CI runs after
the release commit; Docker smoke is still pending. Chrome reload of 27.0.14 was
blocked by the browser-control security boundary, so these live EA results
must not be presented as a live 27.0.14 validation. The new transport and guards
have local regression evidence only until that reload and walkthrough succeed.
