# Auto-SBC Studio browser companion

The Chrome extension and userscript share the reviewed modules in this directory.
The implementation builds on MIT Auto-SBC adapters. It contains no proprietary
SBC Monkey or Paletools code.

## Build

```sh
node frontend/build.mjs
node --test tests/frontend*.cjs
node --check tampermonkey-ai-sbc.user.js
```

Node 22+ is recommended; no npm packages are required. `VERSION` supplies the
release number. Build output includes `tampermonkey-ai-sbc.user.js`,
`plainJavascript.js` and `dist/chrome-extension`. Edit source modules, then rebuild.

See [INSTALL.md](../INSTALL.md) for startup, Chrome installation and updates.
The extension injects only on the listed EA Web App paths. Its isolated worker
defaults to `http://127.0.0.1:8000`; the userscript remains local-only.

## Server destination

Version 27.0.14 adds **Server settings**, also available from the extension’s
toolbar icon. Hosted mode requires an HTTPS origin, a 32–512-character owner
token and explicit destination consent. Chrome grants optional access only to
that chosen host. The token stays in extension local storage restricted to
trusted contexts; it is not exposed to the EA page or solve exports.

Before solving, the panel displays the selected address. Requests omit cookies,
reject redirects and permit only health and solve-job routes. The EA tab pins
its initial origin/configuration revision. A changed setting blocks further
requests and fresh pre-Save/Submit checks until the tab is reloaded. Stop any
queue before opening settings; an already-dispatched request can still finish.

The single-owner hosted profile accepts owned squads, up to 30 seconds and
5,000 input cards, with a default 200-card chemistry cap. Larger inputs are
rejected without trimming. Concepts require local mode. Render configuration is
prepared and its small synthetic Docker CI smoke passed. Deployment and hosted
lifecycle tests remain pending; see [the deployment guide](../deploy/README.md).

## Solve and review

Open **Auto-SBC Studio**, choose season and market, and load the SBC list.
Select a set and challenge, review card rules and budgets, then solve.
**Solve with Auto-SBC** on EA’s native squad screen enters the same flow.
Navigation or challenge changes invalidate its pending preview.

**Solve and preview** uses owned inventory plus fresh catalog concepts when
allowed in local mode. **Solve with live prices** reads a bounded set of current EA market
listings. The server joins exact card definitions to public metadata; live mode
cannot fall back to snapshot prices. Quotes expire after two minutes for live
prices or six hours by default for provider snapshots.

The preview keeps owned-card value separate from purchase coins. Concepts need
exact card and athlete identities, source timestamps and matching season/platform.
Missing prices, unsupported results or inconsistent shopping-list proof cannot
become an actionable squad. The search reports observed coverage; an optimum in
that pool is not a claim about the entire market.

The planner may refresh stale valuation through bounded public price snapshots;
provider requests contain no club payload. Missing or stale prices do not weaken
the value cap. `PRICES_UNAVAILABLE` identifies a price-limited failed solve
without claiming the full club is infeasible.

Individual **Apply squad** checks current ownership, locks, identities,
requirements and preview freshness, then saves the reviewed squad. It resolves
concepts through EA concept search and places the exact returned entities. It
never buys the players. Individual submission remains a native EA action.

## Automatic queues

Add selected sets, review the finite list, enable its submission checkbox and
start the queue. Each set runs for one cycle only; completed parts and exhausted
rights are skipped. Played-card and evolution protection are mandatory, concepts
are disabled, and the guard runs again before Save and Submit.

The adapter uses EA’s native submit method with saved-squad validation enabled.
A successful response grants rewards; the following read-only stage verifies the
exact receipt and completion counters. It does not send a separate claim request,
open a pack or select a player-pick reward.

**Stop queue** prevents subsequent effects; an already-dispatched request may
still finish. A local journal is written before every effect. Failed persistence,
timeouts, mismatched receipts and uncertain writes stop processing. Reload never
resumes the run. Download the report or read it under its details section.

**Verify last submission** is limited to a recorded successful submission whose
subsequent completion read failed. It checks fresh set/challenge counters and
preserves the original receipt without dispatching another submission.

## Complete dailies

Choose **Build daily plan** to read current rights for Daily Bronze, Daily Silver,
Daily Common Gold and Daily Rare Gold upgrades. Review counts, enable its separate
submission checkbox and select **Start daily plan**.

Only positive finite rights are included. Default bounds are 30 per set and 80 in
total; larger plans are rejected with an explanation. The plan is frozen and
runs bronze → silver → common gold → rare gold. Every cycle checks expected
counters. A changed day, season, market or allowance stops the run.

The preset protects played, evolution and special cards and disables concepts.
Rating ceilings are 64, 74 and 82 respectively; per-card value is at most 1,000
coins while preserving a lower selected limit. Manual settings and queue are
restored afterward. Reward packs stay closed. A five-second cancellable pause
separates verified cycles; Stop prevents the next list, solve and account write.

## Compatibility and limits

Paletools item and country/team/league/rarity locks are read from their existing
saved settings without modifying them. Corrupt lock data blocks solving. Saved
accounts’ locks are combined conservatively; temporary unlock exceptions do not
weaken the gate. The native solve button preserves existing view initializer
wrappers and does not replace EA submission methods.

Played-card rules use the same EA getters as Player Bio. Positive or
unreadable lifetime/current counts block selection. EA can initialize absent raw
statistics to zero; this is not an independent history database.

Only set/challenge list reads may retry once after numeric 429 or an integer
500–599 response, with a visible, cancellable delay. The default is 60 seconds;
a usable Retry-After is honored up to five minutes. Two total attempts are the
limit even when the error changes. Unknown 512/521 responses retain their codes
without an inferred cause. Other 4xx responses stop immediately. Load, Save and
Submit are never automatically retried. A 409 can
have several causes. Saved-squad diagnostics are shown only if EA returns a fully
validated bounded list; generic failures remain generic.

Current season and platform must be selected explicitly. FC 27 metadata does not
establish usable prices or live compatibility. Combined same-player native
requirements, OR and unknown eligibility operations stop before solving or
writing. Unsupported chemistry profiles remain excluded with diagnostics; no
expanded puzzle coverage is inferred from that rejection.

See [VERIFICATION.md](../docs/VERIFICATION.md) for actual account results and
[QUALITY-PLAN.md](../docs/QUALITY-PLAN.md) for remaining acceptance checks. Tests
cover policy, lifecycle, read recovery and a mocked adapter; they do not certify
all private EA interfaces or guarantee uninterrupted automation.

## Fresh ownership and stopped 409 verification (27.0.9+)

Each protected inventory read clears the local Club cache and invalidates SBC
Storage before reading cards. Physical ownership is captured before native squad
hydration can add saved references to the local item repository. Every saved
squad is then refreshed and all 23 native player slots, including substitutes
and reserves, become hard locks. Missing or mismatched responses stop the action.
Squad identifiers have their own validation; native squad zero is distinct from
a physical player ID, which must be positive. A zero alias returning another
squad identity is not accepted silently.

Owned-only Apply and batch pre-write checks use fresh exact-definition Club
queries for the reviewed cards; they still refresh all Storage and saved-squad
locks. The ownership record marks that limited Club scope. Solving, concept
previews and no-completion recovery retain full Club reads. The one-card Bronze
path passed live in 27.0.12; this does not certify every native inventory shape.

**Verify cards and replan** supports one narrow case: an eleven-player submission
returned 409, without a successful target receipt. Fresh status must show the
same nonrepeatable, incomplete challenge with zero completion counters both
before and after reading all eleven exact physical cards as still owned. A
changed journal, scope, status, missing player or incomplete read leaves the
attempt unresolved. Success appends evidence, retains the original uncertain
event and prior receipts, and permits a separately started fresh plan. It never
claims the failed attempt completed or repeats that recorded submission.

At the 27.0.14 release checkpoint, **23 automatic parts/cycles** are verified:
14 selected-set parts and nine Bronze dailies. The selected request is complete
at **5/5 sets and 17/17 parts**; three earlier solve/Apply plus native-submit
parts are included in that selected total but excluded from the automatic count.
The final two Yan parts completed through Auto-SBC 27.0.13 with maximum card
rating 95 and a 25,000 value cap while protections remained enabled. The latest 53-cycle daily plan verified two Bronze cycles, then stopped on a
426 list read before any next-cycle effect; 51 cycles remain. Full-plan and hosted validation remain
pending. Report downloads were verified through Chrome’s native Save dialog
and file readback; wider list-error coverage remains distinct from live results.
