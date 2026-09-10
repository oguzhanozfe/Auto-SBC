# Auto-SBC Studio — private beta

Auto-SBC Studio should let a player choose SBCs, protect the cards they care
about, and let the tool do the repeated solving and submission work. The
product is an English Chrome extension with a local solver. It is currently a
private beta distributed as an unpacked extension, not a hosted public service.

These priorities come from the user's repeated requests: place inexpensive
concepts through the tool, complete eligible dailies automatically, return to
unfinished multi-part SBCs, explain stopped runs, and make installation and
updates understandable. [Real-world acceptance cases](REAL-WORLD-CASES.md)
record the observed account scenarios and distinguish live evidence, mocked
tests and pending work. This brief defines acceptance; it does not claim that
a live run currently in progress has finished.

## Find a missing inexpensive card and place its concept

An early-season club may lack the silver or gold card a challenge needs. The
user wants Auto-SBC to find an inexpensive current candidate and put its
concept into the SBC, as part of the solve and preview flow. Requiring a manual
market purchase to demonstrate this feature does not satisfy that request.

Acceptance means the preview shows the exact card version, game edition,
platform, observed price and quote age. Live search compares the listings it
actually reads within the configured limits and describes that scope. Apply
resolves the matching native EA concept and places it without spending coins.
The shopping total stays separate from the market value of owned cards. An
expired quote, wrong-season price or missing listing cannot become a confident
purchase price. Concept placement remains distinct from buying a card or
completing an SBC.

The observed FC 26 concept flow is useful evidence for this journey. FC 27
adapter compatibility and usable FC 27 prices require their own live acceptance
case; a populated catalog or FC 26 test does not establish them.

## Complete the daily allowances the player approves

The user should be able to select **Build daily plan**, see the currently
available repetitions, approve that finite plan, and let Auto-SBC solve, apply,
submit and verify each cycle. A sequence of manual assistant clicks is not the
automation being requested. Bronze and Silver acceptance must include their
real one-player layout with ten fixed slots, alongside the larger gold cases.

Acceptance means the plan stays finite even if allowances reset while it runs.
Fresh checks enforce remaining rights and preserve played, evolved and special
cards, every saved squad's players, and Paletools locks. Daily rating ceilings
are 64 for bronze, 74 for silver and 82 for gold; the card value cap is at most
1,000 coins and respects a lower user limit. Afterward, the user's manual card
rules and selected queue are restored.

If protected eligible inventory supports the plan, the tool completes exactly
those cycles. If it runs out, it stops with the specific shortage and retains
the completed-cycle count and remaining work. Unopened reward packs do not
count as owned player inventory. Buying cards, opening packs, selecting player
picks or relaxing protections requires a separately designed and authorized
flow; none is part of this beta's daily runner.

## Return to a partly completed multi-part SBC

The user may choose a seven-part pick or player SBC after some segments are
already finished, or select a repeatable SBC that still has rights remaining.
The tool should build a fresh queue from that current state. Historical
completion alone must not exclude an otherwise eligible repeatable challenge.

Acceptance means one selected set represents one eligible cycle. Auto-SBC
skips completed parts, solves the remaining parts sequentially, and preserves
confirmed progress if a later part fails. A completed repeatable set leaves the
remaining queue, so restarting after another set fails cannot silently repeat
it. Reload leaves the run stopped; the player can review the durable report
and explicitly choose a fresh queue.

Show groups completed, submission receipts and verified challenge counters
separately. Saving a valid squad is preparation, not completion. The original
five-set request in [REAL-WORLD-CASES.md](REAL-WORLD-CASES.md) is the acceptance
journey for this behavior. Global allocation of cards across every remaining
part is not implemented; sequential solves must not be presented as that
optimization.

## Understand a stop and take the supported next action

When EA rejects a read or submission, the player needs the affected set and
challenge, the stopped stage, confirmed progress, and a usable next action.
Put that summary in the panel. Keep detailed JSON available on explicit
request for inspection or export, rather than making it the primary explanation.

Acceptance follows the evidence available for that attempt. **Verify last
submission** is available for the supported case with an exact successful
receipt and a failed completion check; it verifies counters without resending
the squad. **Verify cards and replan** handles the narrow supported 409 case
with fresh incomplete-state and exact physical-ownership proof. It adds no
completion credit and leaves the run stopped for a newly approved plan.

Neither action is a generic retry button. Unknown outcomes, unreadable journals
and unsupported recovery states stay blocked. A bare 409 does not identify its
cause. Only validated EA saved-squad details can name a squad conflict, and the
tool must never remove protected cards from that squad automatically. Stop
prevents new actions; a request already sent to EA may still complete.

## Install and update an English product

A returning user should launch the local service, download the extension from
the dashboard, load or reload it in Chrome, and identify the running version
without editing source files. The extension, dashboard, server and release
download must agree on the version and terminology. The interface should guide
the player to load SBCs or build a daily plan, and explain an actual connection
or account-readiness problem when one is detected.

Acceptance includes a browser walkthrough from download to a valid preview,
plus an update walkthrough that retains card rules and run evidence without
resuming a queue. Setup must expose privacy information and a feedback route.
The generated extension needs the regression suite and real browser validation;
a successful build alone is insufficient.

## Measure the workloads the player actually asks it to solve

Use [REAL-WORLD-CASES.md](REAL-WORLD-CASES.md) as the release acceptance set:
one-player dailies, protected high-rated fodder, partly completed multi-part
sets, missing live-priced concepts, and the observed recovery boundaries.
Performance measurements should use captured real challenge requirements and
the eligible club pool after the configured protections and filters. Record
the game edition, platform, pool size, fixed slots, rating and chemistry
requirements, quote freshness, time limit, solve outcome and native validation.
Keep private account/card identifiers out of published fixtures and reports.

A synthetic 3,000-player, all-flexible chemistry case is a stress test. Report
it separately with its artificial construction and purpose. It is not evidence
of typical daily latency, realistic eligibility, successful EA submission or
production capacity. Real workload measurements and synthetic stress results
answer different questions and must remain distinguishable in product claims.

## Private-beta limits and public release

The local service and unpacked extension remain the supported distribution.
Live daily completion and the remaining selected-set work must be recorded as
observed results, not inferred from mocked passes. Combined/OR requirement
gaps must be resolved or explicitly rejected before expanding puzzle coverage;
see [QUALITY-PLAN.md](QUALITY-PLAN.md).

Public distribution still needs reliable extension updates, privacy and support
pages, and a usable support channel. A hosted solver additionally needs
user-scoped jobs, abuse controls and compute limits measured on representative
eligible workloads. Deployment decisions and prerequisites are in
[HOSTING.md](HOSTING.md). The beta should earn broader claims through these
concrete journeys rather than promise every puzzle, every market minimum or
unverified superiority over another extension.
