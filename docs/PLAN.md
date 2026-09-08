# Auto-SBC Studio development plan

Updated 2026-09-09. Target: the user’s Auto-SBC fork working beside Paletools, centered on owned + purchasable concept squads and real prices, including an initially small club during FC27 launch. No OpenSpec dependency.

## 1. Establish the product behavior — delivered

The key requirement is knowledge of unowned concept cards and their purchase prices. SBC Monkey combines this with hard exclusions, chemistry requirements and duplicate preference. Its published monthly $3 plan allows 200 solutions/day. Its solver runs on the provider’s backend; the extension fills a reviewable suggestion and the user submits manually. Our implementation computes locally without using that backend.

The baseline fork had useful EA adapters and a CP-SAT solver, but combined invasive inventory/pack hooks with incomplete data files, discarded cards above 50k, conflated names and athlete identities, exploded overlapping rarity groups, and wrote club datasets into shared CSV files. These were concrete repair targets.

Acceptance: attribution preserved, actual fork identified, source behavior recorded, no paid-server or subscription bypass, no copied proprietary extension implementation.

## 2. Reliable single-SBC engine — delivered with stated coverage

Keep one physical inventory card per candidate. Model alternative formation positions, athlete uniqueness, all supported requirement scopes, required cards and hard exclusions. Apply costs from raw market quotes with distinct configurable weights for duplicate untradeable / untradeable / tradeable / concept cards. Use conservative, labeled rating-based estimates only for owned opportunity values. Concepts require fresh actual market quotes; never estimate a purchase price.

Return structured status and a squad with slot indices, rating estimate, chemistry where modeled, price provenance, filtered counts and warnings. Unknown rules must not become a successful squad. Preserve the original numeric status and serialized result fields for compatibility.

Acceptance: synthetic regression tests for identity, scope boundaries, rarity overlap, rating, chemistry, budgets, locks, missing prices, malformed input and infeasible/unknown status. Large-pool benchmarks must state input size, solver limit and actual outcome; no universal latency claim.

## 3. Public local data — delivered

Use SQLite to separate public card definitions from market-price snapshots. Fetch public versioned price blobs and paced definition pages, partitioning to avoid provider search caps. Keep actual club IDs distinct from normalized chemistry club IDs. Respect source failures and rate limiting, retain prior valid data, and resume incomplete traversals.

Acceptance: actual data downloaded; publication and fetch times distinct; missing market quotes never zero; SBC acquisition costs excluded; observed traversal and provider counts recorded separately, with discrepancies disclosed; public cards always concepts. No club ownership or private EA account data fabricated.

## 4. Browser companion and local workspace — owned-card live flow verified

Generate userscript and Manifest V3 extension from the same modules. Read saved Paletools locks conservatively without patching its prototypes. Choose SBC, collect a snapshot, calculate a local background job, inspect result and explicitly apply. Before Apply, re-read locks and inventory and check challenge identity. Submission remains in native EA controls.

The local dashboard offers catalog search, progress/freshness, JSON request import, adjustable cost/protection controls, a synthetic demo and solution export. Restrict local API origins and body sizes, allow only one active solve and retain only a few short-lived result snapshots in memory.

Acceptance achieved: isolated policy and mocked EA integration tests; local API integration tests; actual Chrome dashboard flow; ten authenticated Daily Silver solve/Apply flows followed by native exchanges and reward claims. The user installed the extension. Concept preview is also verified. Native concept placement in 27.0.2 requires extension reload and a live check. Storage Apply and automatic played-history detection remain open.

## 5. Club + market and FC27 preparation — delivered; launch market pending

The server now adds concepts automatically, accepts an empty club in market mode, expands diversified candidate pools up to 20,000 within the requested time and retains its best verified result with the exact quote proof used. Return a shopping list and cash budget independent of owned-card opportunity costs. Category locks also filter purchased concepts.

FC26 and FC27 console/PC caches are isolated. On 2026-09-08, 20,710 actual game27 public cards are downloaded and matched to the source price index, but neither platform has a positive market quote. Report awaiting_market_prices until a subsequent price refresh supplies real quotes. The provider reports 14 fewer cards than it returns; the status exposes this discrepancy. Never relabel FC26 prices or cards.

Acceptance achieved:9 owned + 2 concept and empty club with 11 concepts with 33 chemistry; separate cash-budget tradeoffs; stale/unknown/objective/nonmarket quote rejection; cross-season and scope guards; progressive expansion; selected quote proof retained across a price update; unknown metadata does not produce a false infeasibility proof. Real FC26 catalog test:75 rating,11 purchases,2,500 coin in 15.2 seconds; feasible, not proven globally cheapest.

## 6. Next acceptance gate: live FC 26 and FC27 compatibility

After installing the generated package, capture a real club/SBC request using the panel’s explicit export. Start with a low-risk SBC preview. Confirm position assignment, available items, market values, Paletools locks and the EA requirement indicator. Compare EA’s displayed squad rating with the model around fractional boundaries. No challenge submission is needed to validate the preview.

Build compact, anonymized fixtures from voluntarily exported data. Record current EA adapter shapes, especially special chemistry profiles and gender-linked club IDs. Support additional calculation types only when semantics are verified. This gate determines whether the fork is ready to replace the user’s daily paid-solver workflow.

## 7. Subsequent product improvements

| Capability | Concrete acceptance criterion |
| --- | --- |
| Multi-SBC allocation | One global inventory reservation model, no reuse of the same physical card across challenges, aggregate cost objective and reviewed per-SBC output. |
| More solution choices | Produce genuinely different feasible squads with explained cost/duplicate differences, preserving all constraints and locks. |
| Rich special chemistry | Real profile fixtures covering each EA calculation type; exact contribution and in-position/full-chemistry checks. |
| Rating calibration | Captured boundary examples verified against EA; keep unknown cases labeled until evidence supports them. |
| Stronger performance | Repeatable 1k/3k/5k-club benchmarks across rating-only, chemistry and mixed constraints, reporting feasibility time, objective and proof gap. |
| Market search quality | Compare progressively expanded concept pools against offline full-catalog optimum benchmarks on launch-style chemistry SBCs; report actual purchase cost and proof gap. |
| FC27 launch readiness | Once public quotes arrive, refresh the FC27 cache and validate live adapter/chemistry fixtures before claiming daily-use compatibility. Season isolation is already implemented. |

Prioritize verified single-SBC use before any batch/grind controls. “Best” must be measured by correctness, protected-card behavior, cost quality and practical solve time against known fixtures, rather than a feature count.

## Source references

- SBC Monkey official FAQ: https://www.sbcmonkey.com/
- Official extension listing: https://chromewebstore.google.com/detail/fdkndehkhodnbelfdlnpgnmegjdklkic
- Original Auto-SBC: https://github.com/titiroMonkey/Auto-SBC
- User’s fork: https://github.com/oguzhanozfe/Auto-SBC
- Paletools: https://pale.tools/fifa/paletools.html
- Public FC 26 data: https://www.fut.gg/players/
- EA chemistry thresholds: https://www.ea.com/ea-originals/news/pitch-notes-fifa-23-fut-chemistry-update
