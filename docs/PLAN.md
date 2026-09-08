# Auto-SBC Studio development plan

Updated 2026-09-08. Target: the user’s FC 26 Auto-SBC fork working beside Paletools, with independently implemented SBC Monkey-style selection. No OpenSpec dependency.

## 1. Establish the product behavior — delivered

SBC Monkey is a club-based solver using market values, hard exclusions, chemistry requirements and duplicate preference. Its published monthly $3 plan allows 200 solutions/day. Its solver runs on the provider’s backend; the extension fills a reviewable suggestion and the user submits manually. Our implementation computes locally without using that backend.

The baseline fork had useful EA adapters and a CP-SAT solver, but combined invasive inventory/pack hooks with incomplete data files, discarded cards above 50k, conflated names and athlete identities, exploded overlapping rarity groups, and wrote club datasets into shared CSV files. These were concrete repair targets.

Acceptance: attribution preserved, actual fork identified, source behavior recorded, no paid-server or subscription bypass, no copied proprietary extension implementation.

## 2. Reliable single-SBC engine — delivered with stated coverage

Keep one physical inventory card per candidate. Model alternative formation positions, athlete uniqueness, all supported requirement scopes, required cards and hard exclusions. Apply costs from raw market quotes with distinct configurable weights for duplicate untradeable / untradeable / tradeable / concept cards. Use conservative, labeled rating-based price estimates only when necessary.

Return structured status and a squad with slot indices, rating estimate, chemistry where modeled, price provenance, filtered counts and warnings. Unknown rules must not become a successful squad. Preserve the original numeric status and serialized result fields for compatibility.

Acceptance: synthetic regression tests for identity, scope boundaries, rarity overlap, rating, chemistry, budgets, locks, missing prices, malformed input and infeasible/unknown status. Large-pool benchmarks must state input size, solver limit and actual outcome; no universal latency claim.

## 3. Public local data — delivered

Use SQLite to separate public card definitions from market-price snapshots. Fetch public versioned price blobs and paced definition pages, partitioning to avoid provider search caps. Keep actual club IDs distinct from normalized chemistry club IDs. Respect source failures and rate limiting, retain prior valid data, and resume incomplete traversals.

Acceptance: actual data downloaded; publication and fetch times distinct; missing market quotes never zero; SBC acquisition costs excluded; completion matched to provider totals; public cards always concepts. No club ownership or private EA account data fabricated.

## 4. Browser companion and local workspace — delivered; live acceptance pending

Generate userscript and Manifest V3 extension from the same modules. Read saved Paletools locks conservatively without patching its prototypes. Choose SBC, collect a snapshot, calculate a local background job, inspect result and explicitly apply. Before Apply, re-read locks and inventory and check challenge identity. Submission remains in native EA controls.

The local dashboard offers catalog search, progress/freshness, JSON request import, adjustable cost/protection controls, a synthetic demo and solution export. Restrict local API origins and body sizes, allow only one active solve and retain only a few short-lived result snapshots in memory.

Acceptance achieved: isolated policy and mocked EA integration tests; local API integration tests; actual Chrome dashboard flow with sample input. Pending: user-installed extension and authenticated EA preview inspection. Chrome extension-management access was blocked in the agent session, so neither installation nor live-account correctness is claimed.

## 5. Next acceptance gate: live FC 26 compatibility

After installing the generated package, capture a real club/SBC request using the panel’s explicit export. Start with a low-risk SBC preview. Confirm position assignment, available items, market values, Paletools locks and the EA requirement indicator. Compare EA’s displayed squad rating with the model around fractional boundaries. No challenge submission is needed to validate the preview.

Build compact, anonymized fixtures from voluntarily exported data. Record current EA adapter shapes, especially special chemistry profiles and gender-linked club IDs. Support additional calculation types only when semantics are verified. This gate determines whether the fork is ready to replace the user’s daily paid-solver workflow.

## 6. Subsequent product improvements

| Capability | Concrete acceptance criterion |
| --- | --- |
| Multi-SBC allocation | One global inventory reservation model, no reuse of the same physical card across challenges, aggregate cost objective and reviewed per-SBC output. |
| More solution choices | Produce genuinely different feasible squads with explained cost/duplicate differences, preserving all constraints and locks. |
| Rich special chemistry | Real profile fixtures covering each EA calculation type; exact contribution and in-position/full-chemistry checks. |
| Rating calibration | Captured boundary examples verified against EA; keep unknown cases labeled until evidence supports them. |
| Stronger performance | Repeatable 1k/3k/5k-club benchmarks across rating-only, chemistry and mixed constraints, reporting feasibility time, objective and proof gap. |
| Broader concept pool | Constraint-aware candidate retrieval with explicit coverage; current browser preview limits concepts to 1,000 catalog cards. |
| FC 27 | Separate definitions/price cache and verified adapter fixtures; never silently treat FC 26 data as FC 27. |

Prioritize verified single-SBC use before any batch/grind controls. “Best” must be measured by correctness, protected-card behavior, cost quality and practical solve time against known fixtures, rather than a feature count.

## Source references

- SBC Monkey official FAQ: https://www.sbcmonkey.com/
- Official extension listing: https://chromewebstore.google.com/detail/fdkndehkhodnbelfdlnpgnmegjdklkic
- Original Auto-SBC: https://github.com/titiroMonkey/Auto-SBC
- User’s fork: https://github.com/oguzhanozfe/Auto-SBC
- Paletools: https://pale.tools/fifa/paletools.html
- Public FC 26 data: https://www.fut.gg/players/
- EA chemistry thresholds: https://www.ea.com/ea-originals/news/pitch-notes-fifa-23-fut-chemistry-update
