# Auto-SBC Local companion

This is an independently implemented local companion built on the MIT-licensed
TitiroMonkey Auto-SBC repository and its EA service adapters. It does not contain
SBC Monkey or Paletools proprietary code. Both installation formats are generated
from `policy.js` and `companion.js`; do not edit the generated files.

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

Select a set and challenge. Set the rating ceiling, card budget, purchase budget,
total squad-value budget,
tradeable/storage/special/evolution preferences, cost weights and optional item
locks or required item IDs. Defaults protect special/evolution cards, enable
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
made automatically. Buy any wanted cards yourself, refresh inventory, and solve
again before applying the resulting owned squad.

**İnceledim · Kadroyu SBC’ye uygula** re-reads inventory and locks, checks the
challenge still matches, and saves the squad to that challenge. It does not submit
the challenge. The preview expires after five minutes. Native EA submission
remains manual. There are no pack, player-pick, market, discard, repeat, login
automation, or keyboard shortcut hooks. Closing the panel does not cancel a job;
the explicit **İptal** button discards its result. The backend may finish the
current job before accepting another request.

## Paletools compatibility scope

The adapter reads saved `paletools:<year>:<account>:lockedItems` entries and the
`paletools:settings` (plain JSON or base64 JSON) country/team/league/rarity lock
rules. These formats were inspected in the public installation script linked at
<https://pale.tools/fifa/paletools.html> on 2026-09-08. It does not load or bundle
that script. All saved accounts' explicit locks are combined conservatively;
temporary Paletools per-item unlock exceptions are not allowed to weaken them.
Corrupt lock data blocks solving. Existing Auto-SBC global/set/challenge
`excludePlayers` settings are also preserved. This companion never modifies
Paletools storage and does not replace EA or Paletools prototypes.

Public catalog concepts form a server-selected, diversified pool filtered using
the active policy and challenge attributes. The server can expand the candidate
pool within the request's solve budget. The panel displays coverage; a bounded
selection does not guarantee the cheapest squad across the entire market.
Concepts are never represented as owned EA entities, purchased or applied. Stale
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
solve is read-only, explicit Apply is the only squad-save path, lock changes after
review prevent Apply, and cancellation/foreign IDs cannot produce an actionable
preview. Mixed, market-only and FC 27-without-quotes cases are covered, along with
cross-season quotes, stale prices, source/identity/shopping-list tampering and the
separate purchase budget. The current user's live EA account was not used to test or save a squad.
EA's private adapter APIs may change; unreadable responses fail with diagnostics.
