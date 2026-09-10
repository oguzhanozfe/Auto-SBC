# Privacy — Auto-SBC Studio private beta

The Chrome extension reads the signed-in EA Web App’s SBC requirements, owned
player cards, saved-squad references and protection settings to build squads and
carry out the finite queue you start. Your computer is the default solver
destination. Version 27.0.14 also lets you explicitly choose a private HTTPS
server. A Render deployment has not yet been completed for this release.

## Where data goes

- In local mode, club-card data and SBC requirements go to
  `http://127.0.0.1:8000` and are processed on your computer.
- In hosted mode, that payload goes to the exact HTTPS origin you enter and
  approve. It can include physical card IDs, public definitions, ratings,
  positions, ownership/protection fields and challenge requirements. The server
  operator and hosting provider process it. Use a server you control and review
  the provider’s privacy terms before opting in.
- EA passwords, cookies and session tokens are not sent to the solver. EA
  requests and account actions stay in the signed-in Web App. This application
  has no analytics tracker.
- The solver can fetch public definitions and price snapshots from FUT.GG.
  Price refreshes send no club payload. Public catalog data is cached separately
  from your owned inventory.
- Local live market mode reads listings through your EA session and sends the
  observed quotes/public definitions to the local solver. The hosted evaluation
  profile supports owned cards only; concepts and full catalog sync are disabled.

## Credentials and browser records

The hosted owner token stays in the extension’s local storage, restricted to
trusted extension contexts. It is attached only to requests to the configured
solver, never sent to the EA page or included in solve exports. It grants access
to that single-owner server’s jobs and diagnostics; do not share it. Switching
back to local mode clears the stored token. Application access logging is
disabled in the hosted entry point; hosting providers may keep operational logs.

Card preferences and run journals remain in the EA page’s browser storage.
Journals can contain physical card IDs, challenge IDs, timestamps and reward
evidence. They help prevent uncertain submissions from being replayed.
Downloaded requests, solutions and reports can also contain club data; inspect
them before sharing. Uninstalling the extension does not automatically erase
EA-origin browser records or downloaded files.

## Server storage and retention

Club inputs, results and bounded solver diagnostics remain in process memory.
Completed job results are available for up to ten minutes; stale entries are
removed on later job requests, and a process restart clears them. Diagnostics
are bounded in-memory records, not subject to the same ten-minute promise.
A free host may sleep or restart and lose a job. A missing job requires a fresh
review without replaying an EA action.

Local public catalogs remain in the package’s `data` directory. The hosted image
contains public definition/rating seeds and uses ephemeral public-price storage.
Its build excludes local databases, club exports, journals and secrets. There
is no shared multi-user account system.

## Your actions

Individual Apply saves a reviewed squad. An explicitly started finite queue or
daily plan submits eligible owned cards to EA, which removes those cards from
the club. Stop prevents subsequent actions; it cannot withdraw an already-sent
request. Auto-SBC does not purchase cards, open packs or select player picks.

Stop runs before changing the solver destination. After saving settings, reload
the EA tab and confirm the displayed server before continuing. Fresh checks
block an old preview from being saved or submitted after settings change.
Resolve uncertain runs before deleting journals; other EA extensions may use
the same site’s storage.
