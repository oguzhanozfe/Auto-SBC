'use strict';
const T = AutoSBCTransport;
const byId = id => document.getElementById(id);
const mode = byId('mode'), origin = byId('origin'), token = byId('token'), consent = byId('consent');
const status = byId('status'), save = byId('save');
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
function showDestination() {
  byId('hosted').hidden = byId('hosted').disabled = mode.value !== 'hosted';
  origin.required = token.required = mode.value === 'hosted';
  consent.required = mode.value === 'hosted';
  try { byId('destination').textContent = T.httpsOrigin(origin.value); }
  catch { byId('destination').textContent = 'the HTTPS server entered above'; }
}
mode.addEventListener('change', () => { consent.checked = false; showDestination(); });
origin.addEventListener('input', () => { consent.checked = false; showDestination(); });
(async () => {
  await storageReady;
  const stored = await chrome.storage.local.get(T.STORAGE_KEY), selected = T.config(stored[T.STORAGE_KEY]);
  mode.value = selected.mode;
  if (selected.mode === 'hosted') origin.value = selected.origin;
  byId('current').textContent = `Current destination: ${selected.origin}${selected.mode === 'hosted' ? ' · token saved in this extension' : ''}`;
  showDestination();
})().catch(() => { byId('current').textContent = 'Saved settings are unreadable. Choose and save a destination again.'; showDestination(); });
byId('settings').addEventListener('submit', async event => {
  event.preventDefault(); status.textContent = '';
  try {
    const value = mode.value === 'hosted' ? T.config({mode:'hosted',origin:origin.value,token:token.value,consent:consent.checked,revision:crypto.randomUUID()}) :
      T.config({mode:'local',origin:T.LOCAL,revision:crypto.randomUUID()});
    // Must run directly in this user gesture, before awaiting storage operations.
    const permission = value.mode === 'hosted' ? chrome.permissions.request({origins:[`${value.origin}/*`]}) : Promise.resolve(true);
    save.disabled = true;
    if (!(await permission)) throw new Error('Chrome did not grant access to that server. The previous destination is unchanged.');
    await storageReady;
    await chrome.storage.local.set({[T.STORAGE_KEY]:value});
    token.value = ''; consent.checked = false;
    byId('current').textContent = `Current destination: ${value.origin}${value.mode === 'hosted' ? ' · token saved in this extension' : ''}`;
    status.textContent = 'Saved. Reload the EA tab before solving, then confirm its destination and check the server.';
  } catch (error) { status.textContent = error.message; }
  finally { save.disabled = false; }
});
