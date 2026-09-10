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

On Windows, use:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-lock.txt
node frontend/build.mjs
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

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

The extension uses the local service at port 8000. A custom server port currently
requires a matching extension build; changing `AUTOSBC_PORT` alone does not
reconfigure the extension. Alternatively, install the generated userscript with
Tampermonkey; use the Chrome extension if EA’s page policy blocks that format.

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
backend updates. Existing reports and settings are preserved; runs never resume
on reload. Verify any unresolved submission before starting another queue.

## Troubleshooting

- **Studio disconnected:** keep its Terminal open, confirm the dashboard opens,
  then select **Check server** in the extension.
- **Wrong version already running:** stop that Studio Terminal with Ctrl+C and
  run the updated launcher. The launcher never takes over an unrelated process.
- **No current concept prices:** check season/platform and source age in the
  Player catalog. Missing FC 27 prices cannot be replaced with FC 26 prices.
- **EA session expired:** sign in through the Web App and reload its SBC list.
- **Stopped queue:** inspect the report. A saved squad is not completion proof;
  a receipt and verified counters are recorded separately.

Current compatibility and measured live results are in
[VERIFICATION.md](docs/VERIFICATION.md). Share a reproducible bug on the
[beta pull request](https://github.com/oguzhanozfe/Auto-SBC/pull/1), after removing
club item IDs, account details and other private data from attachments.
