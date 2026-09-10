/* Requests go only to the user's configured solver. No EA credentials, MIT. */
'use strict';
importScripts('transport.js');
const T = AutoSBCTransport;
// Prevent content scripts from reading the access token through chrome.storage.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function selectedServer() {
  await storageReady;
  const stored = await chrome.storage.local.get(T.STORAGE_KEY);
  return T.config(stored[T.STORAGE_KEY]);
}
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!T.eaSender(sender, chrome.runtime.id)) return false;
  if (message?.type === 'autosbc-server-info') {
    selectedServer().then(value => respond(T.info(value))).catch(error => respond({error: error.message}));
    return true;
  }
  if (message?.type === 'autosbc-server-options') {
    chrome.runtime.openOptionsPage().then(() => respond({ok:true})).catch(() => respond({error:'Open this extension’s options from chrome://extensions.'}));
    return true;
  }
  if (message?.type !== 'autosbc-local-http') return false;
  (async () => {
    const selected = await selectedServer();
    const request = T.request(selected, message);
    if (selected.mode === 'hosted' && !(await chrome.permissions.contains({origins:[`${selected.origin}/*`]}))) {
      throw new Error('Server permission is missing. Open extension settings and save the selected server again.');
    }
    const controller = new AbortController();
    const timeout = Math.min(Math.max(Number(message.timeout) || 15000, 1000), 25000);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(request.url, { ...request.options, signal: controller.signal });
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch { throw new Error('The configured solver did not return JSON.'); }
      // Only API JSON and public destination metadata cross into the EA page.
      respond({ ok: response.ok, status: response.status, body, serverOrigin: selected.origin });
    } catch (error) {
      respond({ error: error.name === 'AbortError' ? 'The configured solver request timed out. It may still be running; do not repeat an uncertain job.' :
        'Cannot reach the configured solver. Check its status, address and permissions. Redirects are not followed.', serverOrigin: selected.origin });
    } finally { clearTimeout(timer); }
  })().catch(error => respond({error:error.message}));
  return true;
});
