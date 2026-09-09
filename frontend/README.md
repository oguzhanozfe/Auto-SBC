# Auto-SBC Local companion

This is an independently implemented local companion built on the MIT-licensed
TitiroMonkey Auto-SBC repository and its EA service adapters. It does not contain
SBC Monkey or Paletools proprietary code. Both installation formats are generated
from `policy.js`, `native-entry.js`, `batch-policy.js`, `batch-runner.js`,
`daily-plan.js`, `read-retry.js` and `companion.js`; do not edit the generated files.

## Build and test

```sh
node frontend/build.mjs
node --test tests/frontend*.cjs
node --check tampermonkey-ai-sbc.user.js
```

There are no Node package dependencies. The build produces:

- `tampermonkey-ai-sbc.user.js`: installable userscript, no external dependencies.
- `plainJavascript.js`: the same source for manual page-context use.
- `dist/chrome-extension/`: unpacked Manifest V3 extension with the same UI and
  policy source, an isolated message bridge, and a localhost-only network worker.

## Installation

Use one installation format at a time. Disable the old Auto-SBC version to avoid
its legacy submit/pack hooks; Paletools can remain enabled. Start the local server
first. Chrome extension management must be performed by the user:

1. Open Chrome's extension management page and enable Developer mode.
2. Choose **Load unpacked** and select `dist/chrome-extension`.
3. Open the EA FC Web App and sign in. Refresh a tab that was already open.
4. Open **Auto-SBC Local** at the bottom right, explicitly choose FC 26 or FC 27
   and console/PC prices, then choose **SBC listesini yükle**. The selection is
   saved locally. If EA exposes its season, a conflicting selection is rejected.

Alternatively install the generated userscript with Tampermonkey. It uses page
context to access EA's adapters and fetches only the localhost server. If EA's CSP
blocks localhost requests, use the bundled extension. The extension requests only
`http://127.0.0.1:8000/*` host access, plus injection on the EA Web App URL paths.

## Review flow

On the native EA SBC squad screen, **Auto-SBC ile çöz** appears after the native
Exchange button. It uses the unique `autosbc-native-solve` ID, so it can coexist
with SBC Monkey's button. Its click handler is bound before it is inserted. The
button stays disabled until the active EA challenge has loaded, its identity is
stable, an explicit season/platform has been chosen, and the scoped local backend
is known to be available. Hover the disabled button for the missing prerequisite;
the floating Auto-SBC panel provides the scope and backend controls.

The native entry resolves the current challenge through the MIT upstream EA
controller adapter and uses the same solve-and-review pipeline as the floating
panel. It reads current IDs again on click. Leaving the challenge discards a
pending result and prevents applying its preview. In this individual review flow,
**Apply remains an explicit second action**, and native **Exchange Players remains
manual**. Requirements for
special cards never weaken the selected protection policy automatically.

Select a set and challenge. Set the rating ceiling, card budget, purchase budget,
total squad-value budget,
tradeable/storage/special/evolution/played-card preferences, cost weights and optional item
locks or required item IDs. Defaults protect special/evolution/played cards, enable
mixed club-and-market solving, use a rating ceiling of 89, and prefer untradeable duplicates at 10% of
market cost, other untradeables at 70%, tradeables at 100%.

**Çöz ve önizle** reads club cards, SBC storage, unassigned duplicate references and
challenge requirements, then creates a local solve job scoped to the selected
season and price platform. The server adds actual-priced catalog concepts; the
browser never invents owned entities or fetches an arbitrary first catalog page.
An empty eligible club can request a fully priced market squad. The result must
contain exactly the required number of eligible, unique athletes and valid squad
positions. Owned cards must exist in the submitted inventory. Selected concepts
must match separate server catalog proof by card ID, athlete ID, season, platform,
price, source and timestamps. Error statuses cannot become a squad.

The preview separates club opportunity value from coins needed to buy the missing
cards. `maxPurchasePrice` limits only actual purchases; `maxTotalPrice` limits all
selected cards' market opportunity value. Its shopping list shows quantity, card,
actual quoted price, price-source age, source link, season/platform and purchase
total. Proof and shopping-list inconsistencies prevent review. No purchase is
made automatically. Concept Apply resolves exact definition IDs through EA's
concept search and places the returned concept entities directly into the SBC.
The quoted cost is a reference: an available listing can have a different price.

**Anlık piyasadan çöz** queries the signed-in EA transfer market for the chosen
bronze/silver/gold quality within the configured price ceiling. Search is bounded
and reports the observed pool; it does not claim an exhaustive market scan. The
request sends only card definitions, observed Buy Now prices, scope and search
time to the local solver. Credentials, auction IDs and owned auction entities
are not used as concept proof. The server joins the definitions to its card
catalog and uses those live prices exclusively for concepts. No FUT.GG quote
fallback is allowed in this mode, including when live search returns no cards.
Live prices expire after two minutes and must be refreshed before Apply if stale.
The regular solve button retains the clearly identified FUT.GG snapshot mode.

**İnceledim · Kadroyu SBC’ye uygula** re-reads inventory and locks, checks the
challenge still matches, and saves the squad to that challenge. It does not submit
the challenge. The preview expires after five minutes. Submission in this
individual review flow remains manual. Closing the panel does not cancel a job;
the explicit **İptal** button discards its result. The backend may finish the
current job before accepting another request.

## Explicit finite batch (27.0.5)

In **Otomatik SBC sırası**, choose a set and use **Seçili seti sıraya ekle** for
each desired set. Confirm the checkbox explaining that submitted cards leave
the club, then choose **Sırayı otomatik tamamla**. This separate action authorizes
the selected finite queue to solve, save, submit, verify rewards and continue to
the next unfinished part without a click for every squad. Each selected set is
processed for one cycle only, including repeatable sets; completed parts and
exhausted rights are skipped. The work list is fixed before processing each set.

Batch mode forces played-card and evolution protection on and concepts off.
It uses only existing owned club/storage cards. Before saving and submitting,
the adapter rechecks inventory identities, EA-reported match history, active
squad and Paletools locks, saved squad slots, current requirements and EA's
submission checks. Configuration changes stop the run. A successful EA
`submitChallenge` response grants the rewards; the following reward stage verifies
its exact set/challenge receipt and refreshed completion counters. There is no
second reward-claim request, pack opening or player-pick selection.

**Sırayı durdur** prevents new effects; an EA request already dispatched can still
finish. The local progress journal is written before dispatch, and a failed
journal write prevents that request. A timeout, mismatched receipt or uncertain
write halts the queue without automatic retry. **Çalışma kaydını indir** exports
the local journal and receipts. Page reload never resumes a run automatically;
the report remains for reconciliation with EA's actual completion state.
Neither batch nor individual review purchases players, opens packs, selects
player-pick rewards, logs in, or discards inventory.

The integration follows EA's publicly served
[submission controller](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_4.js?_=10821),
[SBC service and response DTO](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_2.js?_=10821),
and [reward presentation controller](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/js/compiled_3.js?_=10821).
These private interfaces can change. Version 27.0.5 batch behavior is covered by
mocked lifecycle and integration tests. Its first account-level run stopped on
a redundant `requestSets` read returning EA 429 during solve for challenge 4116,
before any save or submit. It completed zero new parts.

## Daily preset and read recovery (27.0.6)

Choose **Daily’leri otomatik yap** to read current EA rights and display a plan.
Review the repetition counts, enable the automatic-delivery checkbox, then choose
**Daily planını başlat**. Only the observed English names Daily Bronze Upgrade,
Daily Silver Upgrade, Daily Common Gold Upgrade and Daily Rare Gold Upgrade are
recognized. The plan processes bronze, silver, common gold, then rare gold.

Each repetition comes from a positive finite EA count, verified against
`repeats - timesCompleted`. Completed, expired, exhausted, unknown or unlimited
rights create no work. The default limits are 30 repetitions per set and 80 total;
exceeding either rejects the plan with an explanation instead of truncating it.
Every cycle requires the expected fresh remaining and completion counters.
An external completion, reset, changed calendar day or changed season/platform
stops the frozen plan rather than adding work.

The preset forces played, evolution and special-card protection, disables
concepts, and limits ratings to 64 for bronze, 74 for silver and 82 for both gold
upgrades. Its per-card value ceiling is at most 1,000 coins and preserves a lower
existing limit. It uses the same guarded owned-card batch path for each cycle.
The manual selected queue and settings are restored afterward. Reward packs and
player picks remain unopened; no market purchase is made.

**Daily sırasını durdur** prevents the next effect or repetition. The whole daily
job and each child batch keep a local journal before dispatch; uncertain or
unreadable prior records block a new run. Reload does not resume a daily job.

Version 27.0.6 permits one retry only for `requestSets` and
`requestChallengesForSet` reads after HTTP 429. It honors a reported delay up to
five minutes, otherwise uses a 60-second fallback; longer reported delays stop
the retry. The visible wait checks Stop repeatedly. A second 429, another error,
or an uncertain save/submit does not trigger another request. This is bounded
recovery behavior, not evidence that EA will accept the retry. Daily and retry
changes are undergoing tests; account-level success remains pending.

## Paletools compatibility scope

The adapter reads saved `paletools:<year>:<account>:lockedItems` entries and the
`paletools:settings` (plain JSON or base64 JSON) country/team/league/rarity lock
rules. These formats were inspected in the public installation script linked at
<https://pale.tools/fifa/paletools.html> on 2026-09-08. It does not load or bundle
that script. All saved accounts' explicit locks are combined conservatively;
temporary Paletools per-item unlock exceptions are not allowed to weaken them.
Corrupt lock data blocks solving. Existing Auto-SBC global/set/challenge
`excludePlayers` settings are also preserved. This companion never modifies
Paletools storage. The native entry wraps only the upstream-identified
`UTSBCSquadDetailPanelView.init` view initializer and preserves its `this`, arguments,
return value and the existing wrapper chain. It does not replace EA ratings,
player entities, submission methods or Paletools behavior.

The active squad is read through EA's squad service on both solve and Apply.
Its owned inventory IDs are hard locks, including any substitutes present in the
returned roster. An unreadable active roster blocks the action. This protects the
current squad. The separate played-card gate uses the same getters as EA Player
Bio and blocks positive or unreadable counts when enabled. EA can initialize
missing raw statistics to zero, so this is not an independent history database.
Current EA boolean `tradable` and legacy boolean `untradeable` are supported.
Missing, nonboolean or conflicting values use the full tradeable cost policy and
are excluded when tradeable cards are disallowed; review labels them as unknown.

Sanitized observed UI fixtures are recorded in
`fixtures/native-ui-observations.json`. Lifetime **COMPLETED**, current **Repeatable**
remaining and the challenge fraction are distinct values. On an exhausted daily,
COMPLETED can disappear while Repeatable explicitly shows zero. Batch availability
uses the verified EA set methods and remaining-rights fields; submission receipts
and refreshed `timesCompleted` counters confirm progress. It does not equate a
repeatable challenge's reset status with an unsuccessful submission. Menu entries
such as **Remove Last Evolution** do not establish that a selected card is evolved.

Public catalog concepts form a server-selected, diversified pool filtered using
the active policy and challenge attributes. The server can expand the candidate
pool within the request's solve budget. The panel displays coverage; a bounded
selection does not guarantee the cheapest squad across the entire market.
Concepts are never represented as owned EA entities or purchased automatically.
After review they can be placed in the SBC as real EA concept entities. Stale
catalog prices are not submitted as current quotes. The backend exposes price
provenance and conservative fallback estimates. Concept and boosted-card
chemistry support remains subject to the backend's supported constraint types.
Missing rarity-group metadata is marked unknown, never invented as group 0.
Concept quotes require a positive actual market price, matching game and price
scope, source timestamps, and a fresh provider snapshot (six hours by default).
Fetch time does not make an old provider quote fresh. SBC/objective acquisition
costs and estimates cannot become purchase prices. FC 27 catalog metadata alone
does not mean market quotes are ready: the panel reports unavailable FC 27 prices
and permits owned-only solutions while refusing substitute FC 26 purchase prices.

## Verification limits

Node tests cover the pure policy, Paletools formats, malformed/unsafe responses,
legacy position mapping and a mocked EA adapter workflow. The mock checks that a
solve is read-only, individual Apply and the explicit batch use the guarded
squad-save path, lock changes after
review prevent Apply, and cancellation/foreign IDs cannot produce an actionable
preview. Mixed, market-only and FC 27-without-quotes cases are covered, along with
cross-season quotes, stale prices, source/identity/shopping-list tampering and the
separate purchase budget. Native-entry tests cover original initializer semantics,
handler binding before mount, repeated rendering, missing/late challenge data,
rapid clicks, challenge identity changes and result cancellation on navigation.
The installed 27.0.1 extension completed ten owned-card Daily Silver solve/Apply
flows on 2026-09-09; native exchanges and reward claims were verified separately.
Native live-price concept placement passed in 27.0.3: Mason Toye, 65-rated, at a
200-coin observed EA price, with no purchase or submission. In the
27.0.4 task, 10x 85+ and two 91-rated parts of the 98+ FOF/FUTTIES Pick have
completed using Auto-SBC solve/Apply followed by native submission: **1/5 groups,
3/17 parts**. Consumed cards passed zero-game checks and the coin balance remained
**577,251**. These are not results of the batch runner. The 27.0.5 live queue
stopped at a set-list 429 before any save or submit, adding zero completions.
The other parts and groups remain pending. Version 27.0.6 daily execution and
successful read-retry recovery have not yet been validated on the account.
Batch tests cover finite queues, completed-part skipping, mandatory owned-card
guards, second-part failure, stop during awaited operations, repeatable status
reset, exact receipts, persistence failure and prevention of duplicate submits.
The tests' EA object shapes come from the public adapter and controlled fixtures;
a mock pass is not account-level live validation.
EA's private adapter APIs may change; unreadable responses fail with diagnostics.
