# Real-world acceptance cases

Release checkpoint: **27.0.14, 10 September 2026**. The selected five-set request
stands at **5/5 sets and 17/17 parts**: 14 selected-set parts completed
automatically and three through earlier solve/Apply plus native submission.
The latest live session added Provisions, Ultimate Rewind, five Bronze
dailies and the final two Yan parts through Auto-SBC 27.0.13. Nine Bronze dailies are now verified, giving **23 automatic
parts/cycles overall**. Earlier Daily Silver tests are separate. The five selected sets are complete;
the last plan has **51 cycles remaining**. Neither that plan nor the original daily allowance is fully
completed or validated.

“Observed” means an account action or read was verified. “Mocked” means a
controlled test exercises the behavior. “Pending” is an acceptance condition,
not an implemented-feature or completion claim. Detailed history is in
[VERIFICATION.md](VERIFICATION.md); model limitations are in
[QUALITY-PLAN.md](QUALITY-PLAN.md).

## 1. Surplus special cards beside valuable played, evolved and saved-squad cards

**Trigger:** A high-rated SBC needs fodder. The club contains unused special-card
duplicates, a played favorite, an evolution, and a zero-game card on an inactive
saved squad's bench.

**Required behavior:** If the user permits unused specials, consider those
surplus cards while keeping played/evolved cards and saved-squad players locked.
Recheck identities and protections before saving and submitting. Unknown match
history or an unreadable roster must stop the action. Low cost or duplicate
priority must never override protection.

**Evidence:** Observed automatic receipts record zero-game checks; earlier live
10x85+ also passed native requirements with storage cards. Mocked tests cover
inactive benches/reserves, changed locks, unknown stats and mismatched rosters.
The fresh 27.0.9 queue stopped before saving on squad-identity validation;
27.0.10 corrects identifier handling and its fresh all-saved-squad read passed
live. **Pending:** preserve that protection through the remaining multi-part
run. EA Bio getters remain the match-history authority, not an independent
history database. The original bare 409 does not establish a roster conflict.

## 2. Five popular SBC sets with several parts already finished

**Trigger:** The user selects five eligible sets, including a seven-part player
pick and a seven-part player SBC, and asks the tool to complete them.

**Required behavior:** Freeze the selected queue, skip completed parts, and run
one eligible cycle per selected set. Count a saved squad, an accepted submission
and a verified completed part separately. Preserve confirmed progress when the
next part fails; keep completed groups out of the remaining queue.

**Evidence:** Observed completion of 10x85+, the 98+ FOF/FUTTIES Pick,
Provisions, Ultimate Rewind and all seven Yan Diomandé parts. Current progress
is 5/5 sets and 17/17 parts. The final two 92-rated squads succeeded after the
maximum card rating changed from 94 to 95, retaining the 25,000 card value cap
and played/evolution/saved-squad protections. No cards were purchased. Mocked
tests cover finite queues and second-part failures. Squad selection
is sequential; global allocation of club cards across all remaining parts is
not implemented.

## 3. EA confirms submission, then the reward-status read returns 521

**Trigger:** A squad exchange returns the exact successful receipt and granted
awards, but the following set-list refresh fails.

**Required behavior:** Preserve the submission receipt and stop. Never resend
the squad. A supported read-only check may reconcile the exact challenge and
set counters, credit the already completed part, and leave the batch stopped.

**Evidence:** Observed in 27.0.6 on the pick's 90-rated part: EA granted the
reward and native progress increased to 3/7, followed by a 521 read failure.
27.0.7 reconciled it through fresh counters without another submission. Mocked
tests reject missing receipts, mismatched IDs and unchanged counters. This
supports that recovery case; it does not establish recovery for every outage.

## 4. Submission returns 409 with no success receipt

**Trigger:** Yan Diomandé's next squad saves successfully, but Submit returns
409 after eight prior parts in the same report have completed.

**Required behavior:** Stop without completion credit or a write retry. Permit
a separately started fresh plan only after the narrow supported proof: the
same nonrepeatable set and challenge remain incomplete with zero counters, all
11 exact saved physical cards are still owned in fresh Club/Storage responses,
and a final status read agrees. Saved-squad references alone are not ownership.
Preserve the original uncertain event and prior receipts.

**Evidence:** Observed 27.0.9 read-only proof passed for challenge 4152 at
00:21:29 UTC. Its report retained all eight prior completions and gained no new
completion or submission. Mocked tests cover missing cards, stale evidence,
timeouts and other unresolved effects. A fresh protected 27.0.11 queue later completed part 4152 with a new receipt
and counter verification at 00:48:58 UTC. The next 92-rated part reached its
30-second solve limit before saving. Subsequent protected solves completed both
remaining 92-rated parts under the higher maximum card rating described above.
The original 409 cause remains unknown.

## 5. Sixty daily rights, but reward packs are still unopened

**Trigger:** Each of Bronze, Silver, Common Gold and Rare Gold Upgrade has
15 remaining rights. Later repetitions may need cards the club does not own.

**Required behavior:** Run only the approved 60 cycles, in bronze → silver →
common gold → rare gold order, using protected low-rated owned cards. Keep
reward packs unopened. If eligible inventory runs out, stop and explain the
shortage while preserving completed cycles. A pack reward is not ownership of
the players inside it. Do not silently buy cards, open packs, relax protections
or extend the plan.

**Evidence:** Observed 27.0.10 read 15 rights per daily and saved the first Bronze
squad. Native EA showed one 64-rated ST in the open GK slot, 2/2 requirements
satisfied and Exchange enabled. Auto-SBC's pre-submit guard mistook one of the
ten fixed empty slots for a player because EA gives empty slot entities a player
type. It stopped without any submission; no manual exchange was used. Mocked
tests originally missed this native empty-slot shape. The 27.0.11 regression
uses one player and ten regular empty bricks, rejects unexpected owned cards,
and checks again immediately before dispatch. Its first Bronze cycle passed
live at 00:34:43 UTC. The next cycle stopped on an initial 521 list read before
any write; completed progress remained intact. In 27.0.12, a fresh 59-cycle plan
verified two more Bronze cycles. Between them, an initial 521 set-list failure
recovered after the single 60-second retry. The following cycle stopped on an
initial 512 list failure before any write. The three post-solve ownership reads
successfully queried the selected card definitions while refreshing full Storage
and saved-squad locks. They did not repeat the full club scan.

27.0.13 permits one retry for numeric 429 or integer 500–599 only on the two
allowlisted set/challenge list reads. This is an application retry policy;
512/521 have no defined cause in the inspected EA client. The fresh 27.0.13 plan
verified one of its 57 cycles, then stopped on an initial 426 list response
before any write. That 4xx response is outside the retry policy. The test ended
there: 56 rights remain by arithmetic, without another rights refresh. Only the
521 retry was observed live; the broader 5xx range has unit coverage.
The latest live session added five Bronze dailies through Auto-SBC, for nine
verified automatic daily cycles. The latest 53-cycle plan verified two Bronze cycles and stopped on an initial
426 list read before the next write; 51 cycles remain. A five-second cancellable pause now separates verified cycles; its
Stop regression preserves the receipt and prevents the next list, solve and
write. **Pending:** the remaining finite cycles and actual inventory shortages.
A valid saved squad must not be reported as completed.

## 6. Early FC 27, an empty club and an outdated price snapshot

**Trigger:** A new-season club lacks fodder. The user wants the cheapest observed
silver concept placed directly into the SBC, with its current price.

**Required behavior:** Use only matching-season prices. Where the live adapter
works and listings exist, preserve the exact card revision and observed price,
place an EA concept, and refresh quotes older than 120 seconds before Apply.
No listing must remain “no quote”; estimates and FC 26 prices cannot replace it.
Concept placement must not be reported as a purchase or completed SBC.

**Evidence:** Observed in FC 26: an older 200-coin snapshot differed from live
listings starting at 350; later 27.0.3 placed Mason Toye's exact concept using a
live 200-coin quote without buying it. Mocked tests cover empty-club concepts,
quote expiry and season mismatches. On 10 September, FC 27 console and PC
snapshots still had zero usable/fresh prices and a 3 September publication date.
**Pending:** live FC 27 compatibility and a real FC 27 concept flow. The FC 26
one-card test does not prove either.

## 7. Reload or Stop while an exchange outcome is pending

**Trigger:** The user refreshes Chrome, closes the panel, or presses Stop while
an EA request is in flight.

**Required behavior:** Persist the pending attempt before dispatch. Stop blocks
new effects but cannot undo a sent request. Reload must not resume automatically
or replay an uncertain action. Show the durable report and offer only the
recovery supported by its actual evidence; unreadable journals remain blocked.

**Evidence:** Mocked lifecycle and adapter tests cover in-flight Stop, reload,
claim-pending history and persistence failures. The observed 521/409 reports
demonstrate why receipt and uncertainty preservation matter. **Pending:** a
controlled account recovery walkthrough; no successful live interruption test
is claimed, and an exchange must not be repeated merely to test recovery.

## 8. Rights change after planning or the user completes a part elsewhere

**Trigger:** Another session completes a daily, its allowance resets, the date
changes, or a selected challenge completes while this run is preparing a squad.

**Required behavior:** Compare fresh identity, completion and remaining-rights
counters before each cycle and submission. A changed allowance stops the old
plan. Do not expand it after a reset or submit the now-completed part. A new
explicit plan may use the newly observed rights; historical lifetime completion
alone must not exclude a repeatable set with rights remaining.

**Evidence:** Mocked daily tests cover resets, external completion, expiry,
counter changes and cancellation before saving. **Pending:** controlled live
confirmation of this boundary. Each approved plan must remain fixed even if
more rights become available during the run.

## 9. Choose a hosted solver, then change its settings during a review

**Trigger:** A player selects a private HTTPS solver, or changes its origin/token
after a solution has been reviewed.

**Required behavior:** Keep localhost as the default. Require explicit destination
consent and an owner token kept in extension storage. Display the origin before
sending club-card data; never forward EA cookies or credentials. Pin the
loaded EA tab to one configuration. Changed settings must prevent private
requests, Save and Submit until the tab is reloaded and a fresh review begins.

**Evidence:** Implemented extension/adapter tests cover consent, exact permission,
missing or unreadable settings, wrong response origins, changed revisions after
preview and after Save, and Cancel during the fresh settings check. Hosted auth,
limits and synthetic API cases have local tests. **Pending:** Render sign-in,
Docker CI smoke, deployment, synthetic hosted smoke and service sleep/restart
validation. No live hosted club-data run is claimed.

## Next work, ordered by observed friction

1. Carry nine verified Bronze completions through the remaining approved daily
   rights. Preserve receipts, cancellable pacing and no write replay.
2. Retain the complete five-set evidence and repeat the protected workflow on
   future requests. Keep price-limited failure distinct from whole-club
   infeasibility; do not infer global multi-part card allocation.
3. Validate Render with synthetic input and actual service limits before a
   private hosted club run. Keep public hosting unavailable until that setup is
   complete; ordinary local mode remains unauthenticated and local.
4. Preserve the explicit combined/OR rejection until those semantics are
   implemented and checked against EA. Treat FC 27 live behavior and prices as
   separate launch checks.

## Observed chemistry workload, separate from stress testing

The current Pre-Season Challenge 6 was previewed with its actual requirements:
at least five players from one league, at most six nations and four clubs, four
rare players, 81 rating and 31 chemistry. The request preserved its real
formation and each card's actual alternative positions. No squad was applied or
submitted for this measurement.

The local 30-second preview returned **UNKNOWN**, with a message that excluded
cards need additional modeling or rarity-group data. This is neither proof of
infeasibility nor a successful chemistry acceptance test. The input had 3,190
club candidates after frontend protections; that number must not be equated
with the final modeled pool or with a requirement to model every card in every
position. Record eligible/model counts and diagnose coverage/search behavior
before using this workload to choose a host.

Offline replays of that same exported request are documented in
[HOSTING.md](HOSTING.md). Eight-worker runs found a feasible squad within the
30-second budget; a separate one-worker sparse-domain experiment used 587.5 MiB
and 30.251 seconds but returned UNKNOWN with no solution. Other local service
activity could overlap, so these are not controlled speed or hosting-capacity
comparisons. This actual 81-rating/31-chemistry case remains separate from the
historical all-flexible 3,000-card stress test. Neither replaces daily and
rating-only acceptance work or independently excludes a hosting provider.
