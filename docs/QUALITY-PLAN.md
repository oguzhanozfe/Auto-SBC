# Auto-SBC quality plan

The goal is reliable SBC completion with visible limits and preserved club cards. Superiority over every other extension is not established by the current evidence.

## Current evidence and next acceptance checks

| Area | Current evidence | Acceptance check |
| --- | --- | --- |
| Owned squads | Fourteen selected-set parts fully automatic; selected request: 5/5 sets and 17/17 parts. Played/evolution/saved-squad protections retained | Preserve the completed five-set evidence; validate future requests without weakening protections |
| Concept players | Exact FC 26 native concept placement using an observed live quote; no purchase or submission | Preserve exact revision, source, platform and quote age. Local solver only; never pretend a concept is owned |
| Card protection | EA-reported zero-game, evolution, all saved-squad and Paletools checks. Targeted Club ownership checks passed live; Storage and saved squads still refresh | Preserve exact physical/revision identity before save/submit; changed or unreadable protection stops consumption |
| Finite automation | 23 fully automatic parts/cycles: 14 selected-set parts plus nine Bronze dailies | Complete the remaining finite work without replaying successful or uncertain effects |
| Read recovery | Bounded 429 and 521 list retries observed live. Numeric 429/integer 500–599 permit one list-only retry; broader range has unit coverage | Preserve cancellable cooldown and no write retries; do not infer undocumented causes from numeric responses |
| Daily preset | Nine Bronze cycles verified across separately approved plans; latest 53-cycle plan verified two, then stopped on a 426 list read. It has 51 cycles remaining | Validate the remaining cycles and actual eligible-card shortages, preserve manual settings and keep rewards unopened |
| Recovery | Confirmed-submit/521-read reconciled without resubmission; narrow 409 no-completion proof allowed a later fresh protected solve | Preserve original uncertainty and receipts; do not widen recovery beyond its strict status/ownership proof |
| Price diagnostics | Bounded public bulk refresh for stale valuation; `PRICES_UNAVAILABLE` distinguishes missing valuations from whole-club infeasibility | Preserve source age and player value caps when refresh fails; no private payload in provider requests |
| Hosted transport | HTTPS origin selection, bearer auth, destination consent, exact host/origin restrictions and changed-settings guards are implemented and tested | Render account sign-in, deployed synthetic smoke, sleep/wake and repeated-job capacity checks remain pending; the small synthetic Docker smoke passed in [CI34458034938](https://github.com/oguzhanozfe/Auto-SBC/actions/runs/34458034938) |
| FC 27 | Separate catalog exists; prior source had no usable FC 27 market prices | Verify live adapter and matching-season market quotes; never reuse FC 26 prices |

This is the 27.0.14 release checkpoint. Python and browser suites have passed
locally; the final release report records exact counts and CI status after all
changes settle. Unit tests and nine Bronze cycles do not establish full-plan
reliability. The journeys in [REAL-WORLD-CASES.md](REAL-WORLD-CASES.md) prioritize
daily rights, protected rating parts, concepts and understandable recovery.
The actual Pre-Season 6 export is an 81-rating/31-chemistry case; its one-worker
replay returned UNKNOWN with no solution at 587.5 MiB/30.251 seconds. It remains
separate from the all-flexible 3,000-card synthetic stress case and does not
supersede those priorities. See [HOSTING.md](HOSTING.md) for measurement limits.

## Scoped solver acceptance backlog

These gaps were identified by comparing `challengeData` and the constraint model
with EA's public `UTSBCChallengeEntity.isRequirementMet` and `meetsRequirements`
implementations. They are code-level findings, not claims that the current
selected SBCs contain these conditions.

| Boundary | Implemented behavior | Further acceptance scope |
| --- | --- | --- |
| Combined same-player requirements | Multiple predicates in one native requirement are explicitly rejected before solving or saving. They are no longer flattened into unrelated counts; minimum, maximum and exact shapes have regressions | Model the same-player intersection before claiming support. For example, two French LaLiga cards plus two English Premier League cards cannot satisfy “two French Premier League players” |
| Requirement-level OR and unknown operations | OR, missing/unknown operation values and malformed grouping metadata fail closed. Separate supported AND requirements preserve their counts and scopes | Add explicit OR semantics and compare against EA before widening support; do not silently require every branch |
| Native rule validation before saving | Apply verifies exact placed identities; batch submission checks native `canSubmit()` and the relevant feature gates. A locally accepted squad can still be saved before EA's submit verdict rejects it | For owned squads, display the native rule result before save or restore the prior squad on rejection. Preserve concept previews, which cannot submit while concepts remain |

The native `count=-1` sentinel is already handled for verified squad-wide keys;
player-count requirements still reject invalid negative counts. Team rating with
brick slots remains explicitly unsupported. Neither should be described as a
silently ignored constraint. The inherited rating estimate and supported
chemistry profiles still require EA validation for account-level proof.

Source: EA's publicly served
[SBC entities and eligibility methods](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_2.js?_=10821).

## Comparison sources

- [Paletools](https://pale.tools/fifa/): SBC templates and filters, player locks, duplicate handling and reward automation.
- [SBC Monkey](https://www.sbcmonkey.com/): market-aware owned/concept pricing and a reviewed solution workflow.
- [FUT.GG tools](https://www.fut.gg/about/) and [GG Club](https://www.fut.gg/gg-club/): prices, SBC context and club/player information.
- [FUT.GG upgrades](https://www.fut.gg/sbc/category/upgrades/): repetitions and reset information.

A feature not described on these pages must not be presented as absent from the competitor.

## Installation and refresh

Use the existing unpacked extension's refresh button, then reload the EA tab. Version 27.0.14 adds extension storage and optional HTTPS host permissions; the user grants access only to a specifically chosen server through its settings. Never refresh during an active or uncertain submission. Do not add browser-management or debugging permissions just to automate this step. See [Chrome's official reload instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension).
