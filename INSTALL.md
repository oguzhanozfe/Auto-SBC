# Install Auto-SBC Studio

## Start Studio

Extract the full Studio package before running it. On macOS, double-click
**Start Studio.command**. Keep the Terminal window open while using the extension;
press **Ctrl+C** to stop the server. First launch requires Python 3.12 or newer
and downloads pinned packages from PyPI into the project’s `.venv` folder.
An existing matching Studio process is reused.

For a source checkout on macOS or Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
node frontend/build.mjs
./start_server.sh
```

The current service supports macOS and Linux. It uses Unix file locking and
cannot run directly under native Windows Python. On Windows, use a Linux
environment such as WSL and follow the Linux commands above; that setup still
needs its own end-to-end browser validation.
Node 22+ is only needed for the build command. Packaged releases include the
built extension. Open **http://127.0.0.1:8000**, then use **Try sample players**
for a local demonstration without EA sign-in.

## Load the Chrome extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/chrome-extension` in the full
   Studio package, or `Auto-SBC-Chrome` in the extension-only download.
3. Disable the older Auto-SBC or its userscript so only one copy runs.
   Paletools can remain enabled.
4. Open the EA FC Web App and sign in. Reload an already-open EA tab.
5. Open **Auto-SBC Studio**, choose your season and console/PC market, then
   select **Check server** and **Load SBCs**.

The extension defaults to the local service at port 8000. A custom local port
requires a matching extension build; changing `AUTOSBC_PORT` alone does not
reconfigure the extension. The generated Tampermonkey userscript remains local
only; use the Chrome extension for private HTTPS hosting or if EA’s page policy
blocks the userscript.

## Choose a private HTTPS server

This mode is implemented in 27.0.14. A Render instance has not yet been deployed;
the prepared [deployment guide](deploy/README.md) requires account sign-in and
validation before there is a usable hosted address. Ordinary local mode must
not be exposed to the internet.

1. Stop queues. Open **Server settings** in the companion or click the extension
   toolbar icon. Choose **My private HTTPS server**.
2. Enter the exact HTTPS origin without a path or custom port, and the owner
   access token configured on your server. Never enter an EA password. If the
   server requires extension origins, configure the exact extension ID shown in
   `chrome://extensions` as `AUTOSBC_EXTENSION_IDS`.
3. Read the displayed destination and check the consent box for sending selected
   club cards and SBC requirements there. **Save destination** requests Chrome
   permission for that destination; declining leaves the previous settings intact.
4. Reload the EA tab. Confirm the displayed server address and select **Check
   server** before solving. Changed settings invalidate the old tab for further
   requests, Apply and automatic submission. An already-sent request can finish.

The bearer token stays in the extension’s local storage, unavailable to content
scripts, and is omitted from solve exports. Returning to **Local computer**
clears it. Hosted requests omit cookies and reject redirects. The single-owner
profile supports owned squads with a 30-second budget and 5,000 input-card cap;
chemistry defaults to at most 200 input cards. Larger inputs fail explicitly
without dropping candidates. Priced concepts require the local service.

Free hosts may sleep or lose in-memory jobs. After a cold start times out, allow
the service to wake and use **Check server** again. A lost solve job requires a
fresh review; do not retry an uncertain EA submission.

## First squad, queue and daily plan

For one squad, choose a challenge, review card rules and budgets, then
**Solve and preview**. Inspect every proposed card and apply the squad. Individual
Apply saves a squad; native EA submission is a separate action. Concepts remain
concepts until replaced with owned cards.

For an automatic queue, add each desired set, review the displayed list, enable
the submission checkbox and start the queue. Each set runs for one cycle. The
runner checks ownership and protection again before each submission.

For dailies, select **Build daily plan**, review current repetition counts,
enable its submission checkbox and choose **Start daily plan**. It processes only
the finite rights displayed. Both modes keep packs and player-pick rewards closed.

**Stop** prevents new effects. A request already sent to EA can still finish.
After an error, inspect the run report and use the offered read-only verification.
Do not clear an unresolved journal to retry a submission.

## Update

Stop active queues and keep their reports, including any uncertain submission.
Replace the extension files in the same folder, click its **Reload** button in
`chrome://extensions`, then reload the EA tab. Restart the Studio process after
backend updates. This release adds extension storage and optional HTTPS host
access for user-selected servers; it does not grant access to all HTTPS sites at
installation. Existing reports and settings are preserved; runs never resume
on reload. Verify any unresolved submission before starting another queue.

## Troubleshooting

- **Studio disconnected:** keep its Terminal open, confirm the dashboard opens,
  then select **Check server** in the extension.
- **Wrong version already running:** stop that Studio Terminal with Ctrl+C and
  run the updated launcher. The launcher never takes over an unrelated process.
- **`PRICES_UNAVAILABLE`:** bounded public price refresh could not supply enough
  current valuations under your card value limit. Check source freshness and
  retry after prices recover; this is not proof that the full club is infeasible.
- **Hosted unauthorized / permission missing:** check the configured owner token,
  destination permission and exact extension ID on the server. Keep tokens out
  of screenshots and reports.
- **No current concept prices:** check season/platform and source age in the
  Player catalog. Missing FC 27 prices cannot be replaced with FC 26 prices.
- **EA session expired:** sign in through the Web App and reload its SBC list.
- **Stopped queue:** inspect the report. A saved squad is not completion proof;
  a receipt and verified counters are recorded separately.

Current compatibility and measured live results are in
[VERIFICATION.md](docs/VERIFICATION.md). Share a reproducible bug on the
[beta pull request](https://github.com/oguzhanozfe/Auto-SBC/pull/1), after removing
club item IDs, account details and other private data from attachments.
