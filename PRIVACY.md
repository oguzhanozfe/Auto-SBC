# Privacy — Auto-SBC Studio private beta

This release runs on your computer. The Chrome extension reads the signed-in
EA Web App’s SBC requirements, owned player cards, saved-squad references and
protection settings to build squads and carry out the queue you start.

## Where data goes

- The extension sends the selected club-card payload and SBC requirements to
  `http://127.0.0.1:8000`. The local service processes that payload in memory.
- Public player definitions and price snapshots are downloaded from FUT.GG and
  cached in local SQLite databases. Public catalog cards are distinct from your
  owned inventory.
- Live market mode reads listings through your existing EA Web App session.
  Observed prices and public card definitions are sent to the local solver.
- EA sign-in credentials, session tokens and auction actions are not sent to
  the solver. This release has no hosted club-data service or analytics tracker.

## What remains locally

Settings and run journals remain in the EA page’s browser storage. Journals can
contain physical card IDs, challenge IDs, timestamps and reward evidence. They
help prevent an uncertain submission from being replayed. A downloaded request,
solution or report can also contain club data; review it before sharing.

Solver jobs and results are kept temporarily in process memory. Restarting the
service clears them. Public catalogs remain in the package’s `data` directory.
Uninstalling the extension does not automatically erase EA-origin browser
storage or downloaded files. Resolve stopped runs before manually deleting their
records; other EA extensions may use the same site’s storage.

## Your actions

Individual Apply saves the reviewed squad. An explicitly started finite queue or
daily plan submits eligible owned cards to EA, which removes those cards from
the club. Stop prevents subsequent requests; it cannot withdraw a request already
sent. The current product does not purchase cards, open packs or choose rewards.

A future hosted edition will require a separate disclosure of its destination,
retention and account controls before connecting club data. The current hosting
assessment does not enable remote uploads.
