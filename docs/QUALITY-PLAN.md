# Auto-SBC quality plan

The goal is reliable SBC completion with visible limits and preserved club cards. Superiority over every other extension is not established by the current evidence.

## Current evidence and next acceptance checks

| Area | Current evidence | Acceptance check |
| --- | --- | --- |
| Owned squads | Ten selected-set parts fully automatic; selected request: 2/5 groups and 13/17 parts. Played/evolution checks preserved; balance 577,251 | Finish the three remaining groups/four parts with exact receipts and protected-card checks |
| Concept players | 27.0.3: Mason Toye's exact 65-rated EA concept placed using an observed 200-coin listing; no purchase or submission | Preserve identity, source, platform and 120-second live quote age; never pretend a concept is owned |
| Card protection | Zero-game, evolution, all saved-squad and Paletools locks. One-card targeted Club checks passed live; Storage and saved squads still refresh | Preserve exact physical/revision identity and ownership before save/submit; changed or unreadable protection stops consumption |
| Finite automation | 14 fully automatic parts/cycles: ten selected-set parts plus four Bronze dailies. Full selected queue and daily plan remain unfinished | Complete the finite remaining work without replaying successful or uncertain effects |
| Read recovery | One 429 retry and one 521 retry observed live. 27.0.13 allows one list-only retry for numeric 429/integer 500–599; broader range is unit-tested | Preserve bounded cooldown, generic unknown-code reporting and no write retries. The observed next-cycle 426 stays outside the policy |
| Daily preset | Reports verify 1/60, then 2/59, then 1/57 in fresh finite plans: four Bronze cycles. Latest 426 list failure stopped before the next write | Validate remaining cycles and actual eligible-card shortages; preserve manual settings and unopened rewards. Do not claim all 60 passed |
| Recovery | 27.0.7 reconciled confirmed-submit/521-read without resubmission. 27.0.9 proved no completion for 4152/409; a later fresh protected solve completed 4152 | Preserve original uncertainty and receipts; do not widen no-completion recovery beyond its strict status/ownership proof |
| Diagnostics | EA status and solver diagnostics available | Explain exact unsatisfied constraints, stale prices and retry state in ordinary language |
| FC 27 | Separate catalog exists; prior source had no usable FC 27 market prices | Verify live FC 27 adapter, definitions and market prices after launch; never reuse FC 26 prices |

This is the 27.0.13 checkpoint: 227 Python and 337 browser tests passed. These
tests and four live Bronze cycles do not establish full-plan reliability. The
concrete journeys in [REAL-WORLD-CASES.md](REAL-WORLD-CASES.md) prioritize daily
rights, protected rating parts, concepts and understandable stopped-state recovery.
The actual Pre-Season 6 export is an 81-rating/31-chemistry case; its one-worker
replay returned UNKNOWN with no solution at 587.5 MiB/30.251 seconds. It is
separate from the historical all-flexible 3,000-card synthetic stress case and
does not supersede those product priorities. See [HOSTING.md](HOSTING.md) for
measurement and concurrent-activity limits.

## Scoped solver acceptance backlog

These gaps were identified by comparing `challengeData` and the constraint model
with EA's public `UTSBCChallengeEntity.isRequirementMet` and `meetsRequirements`
implementations. They are code-level findings, not claims that the current
selected SBCs contain these conditions.

| Gap | Reproducible example and current behavior | Acceptance scope |
| --- | --- | --- |
| Combined requirements lose the same-player intersection | One EA requirement with multiple `kvPairs` is flattened into separate constraints. “At least two French Premier League players” can therefore be satisfied by two French LaLiga players plus two English Premier League players in the local model; EA counts zero matching players | Preserve the requirement group and count players satisfying every member predicate. Add cases for minimum, maximum and exact counts. Until supported, reject combined shapes explicitly instead of returning a falsely valid squad |
| Requirement-level OR is omitted | `eligibilityOperation` is not exported and the backend applies every constraint. For “at least two French players OR at least two Premier League players,” two French LaLiga players satisfy EA's first branch but can be rejected locally | Carry the operation in the request and model OR explicitly, or reject it as unsupported. Use the same player pool to verify distinct AND and OR outcomes; reject unknown operations |
| Native rule validation happens after saving, at batch submit | Apply verifies placed item identities before `saveChallenge`, but does not read EA's rule verdict. A locally accepted squad can be saved before batch `canSubmit()` rejects it. Batch consumption is already guarded | For owned squads, obtain and display the native rule result before saving or fail before dispatch with restoration of the prior squad. Identify failed requirements. Preserve concept preview support: concepts cannot pass `canSubmit()` merely by meeting rating/chemistry conditions |

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

Use the existing unpacked extension's refresh button, then reload the EA tab. Routine source changes use the same manifest permissions. Never refresh during an active or uncertain submission. Do not add browser-management or debugging permissions just to automate this step. See [Chrome's official reload instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension).
