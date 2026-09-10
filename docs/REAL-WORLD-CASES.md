# Real-world acceptance cases

Live checkpoint: **27.0.13, 10 September 2026**. The selected five-set request stands at **2/5 groups
and 13/17 parts**: ten selected-set parts completed automatically and three
through earlier solve/Apply plus native submission. After the earlier **1/60**
Bronze daily run, a fresh 59-cycle plan verified **2/59** more cycles, and the
27.0.13 plan verified **1/57**. That is four automatic Bronze dailies and
**fourteen automatic parts/cycles overall**, confirmed in the UI and local reports.
Earlier Daily Silver tests are separate. Neither the original 60 rights nor the
replacement plan has been fully completed or validated.

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

**Evidence:** Observed completion of 10x85+ and the 98+ FOF/FUTTIES Pick, with five
Yan Diomandé parts verified. Current progress is 2/5 groups, 13/17 parts; balance
remained 577,251. Mocked tests cover finite queues and second-part failures.
**Pending:** finish the remaining three groups and four parts. Squad selection
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
30-second solve limit before saving. **Pending:** complete the remaining work.
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
**Pending:** the remaining finite cycles and actual inventory shortages before
proposing pack handling. A valid saved squad must not be reported as completed.

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
confirmation of this boundary. The current 60-cycle plan must remain fixed even
if more rights become available during the run.

## Next work, ordered by observed friction

1. Carry the four verified Bronze completions through the remaining daily
   rights. Validate bounded, cancellable list-read recovery while preserving
   receipts and preventing write replay; do not assign undocumented causes to
   the observed 512/521 responses.
2. Carry the now-observed all-saved-squad read through the remaining four parts.
   Improve explanations for actual read, ownership or eligibility failures
   before widening recovery to other uncertain states.
3. Make the proven 521 and narrow 409 recovery paths understandable from the
   report itself. Preserve receipts and counts through every stop or reload.
4. Resolve or explicitly reject combined/OR constraint gaps before broader
   puzzle coverage. Treat FC 27 live behavior and current prices as separate
   launch checks, rather than inferring readiness from catalog size.

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
