# Auto-SBC Studio — private beta

Auto-SBC helps EA Web App users build SBC squads, preserve important cards and
complete a finite queue with an auditable result. English is the product's
interface language. The extension and dashboard use the same names for prices,
card protection, previews and automation.

## Core journeys

- **Build a squad:** choose an SBC, review protection rules, solve and inspect
  the proposed cards. Owned value and coins needed for concepts remain separate.
- **Complete a queue:** select sets, review the finite list and start. Recheck
  protections before every save and submission; show receipts and verified
  completion separately. Remove completed sets from the remaining queue.
- **Complete dailies:** read current finite daily rights, review the plan and
  start protected bronze, silver, common-gold and rare-gold repetitions.
- **Recover a stopped run:** inspect the report in the panel or download it.
  Verify a recorded successful submission through read-only counters when that
  supported recovery is available. Never replay an uncertain exchange.

## Beta release requirements

The English interface, installation guide, release number and diagnostics must
agree. Setup offers the Chrome extension directly, shows the release number and
links to an offline privacy page and beta feedback. A generated extension must pass the existing policy/adapter regression
suite and a real browser smoke test. Record actual live results separately from
mocked tests, and never count a saved squad as a completed SBC.

Before public launch, complete the live daily plan, cover remaining recovery
states, validate all-saved-squad protection live, and resolve or explicitly
reject unsupported combined/OR requirements. See [the quality plan](QUALITY-PLAN.md)
for testable examples. FC 27 compatibility and usable market prices remain
separate launch checks.

## Distribution and hosting

The current distribution is an unpacked Chrome extension plus the local service.
A public release needs stable extension updates, clear privacy/support pages,
an open support channel, user-bound hosted jobs, abuse controls and measured compute limits. The hosted
decision and deployment prerequisites are in [HOSTING.md](HOSTING.md).

The product does not promise to be the cheapest solver across an unobserved
market, complete unsupported puzzles, or outperform every competing extension.
Show the evidence and limits that help users decide whether to run a squad.
