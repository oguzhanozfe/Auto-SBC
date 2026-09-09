# Auto-SBC quality plan

The goal is reliable SBC completion with visible limits and preserved club cards. Superiority over every other extension is not established by the current evidence.

## Current evidence and next acceptance checks

| Area | Current evidence | Acceptance check |
| --- | --- | --- |
| Owned squads | 27.0.1: ten Daily Silver completions. 27.0.4: 10x85+ and two 91-rated parts of the 98+ FOF/FUTTIES Pick, with native submission and zero-game checks; balance stayed 577,251. 27.0.6 added one automatically submitted 90-rated part; selected request: 1/5 groups, 4/17 parts | Complete the remaining four selected FUTBIN sets through the finite queue, recording each exact receipt and protected-card check |
| Concept players | 27.0.3: Mason Toye's exact 65-rated EA concept placed using an observed 200-coin listing; no purchase or submission | Preserve identity, source, platform and 120-second live quote age; never pretend a concept is owned |
| Card protection | Zero-game checks, Evolution, active squad and Paletools locks; pre-Apply reread verified | Recheck at automatic submit; changed/missing stats or locks stop consumption |
| Finite automation | 27.0.5 live queue stopped on a redundant requestSets 429 while solving challenge 4116, before any save or submit; zero new completions | 27.0.6 automatically submitted challenge 4116; native 3/7 confirms it. Complete the remaining queue and preserve exact receipts |
| Read recovery | 27.0.6 implements one bounded 429 retry for set-list and challenge-list reads, with cooldown display and Stop checks; 185 browser tests passed | Verify cooldown and cancellation in the account session; never retry save, submit or an uncertain write |
| Daily preset | 27.0.6 implements finite Bronze/Silver/Common Gold/Rare Gold plans, low-rating profiles, a whole-job journal and separate child batches; live completion is pending | Read today's finite rights, complete each planned cycle once, stop on changed counters or uncertain results, and preserve the manual queue and settings |
| Recovery | Confirmed 27.0.6 submit was followed by an immediate requestSets 521; the UI stopped at read verification | Reconcile exact confirmed-submit receipts against later server counters without repeating submission; keep uncertain writes blocked |
| Diagnostics | EA status and solver diagnostics available | Explain exact unsatisfied constraints, stale prices and retry state in ordinary language |
| FC 27 | Separate catalog exists; prior source had no usable FC 27 market prices | Verify live FC 27 adapter, definitions and market prices after launch; never reuse FC 26 prices |

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
