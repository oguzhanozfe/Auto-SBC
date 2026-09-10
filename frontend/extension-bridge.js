/* Isolated transport; the page never receives the stored bearer token, MIT. */
'use strict';
// Changed settings require an EA reload; a queue cannot silently switch servers.
const pinnedServer = chrome.runtime.sendMessage({type:'autosbc-server-info'}).catch(() => ({error:'Server settings are unavailable. Reload the EA tab.'}));
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const {source,id,path,method,data,timeout} = event.data || {};
  if (!['autosbc-local-request','autosbc-server-info-request','autosbc-server-options-request'].includes(source) ||
      typeof id !== 'string' || id.length > 100) return;
  const responseSource = source.replace('-request','-response');
  try {
    if (source === 'autosbc-server-options-request') {
      const response = await chrome.runtime.sendMessage({type:'autosbc-server-options'});
      window.postMessage({source:responseSource,id,...response},location.origin); return;
    }
    const pinned = await pinnedServer;
    if (!pinned || pinned.error || typeof pinned.revision !== 'string') throw new Error(pinned?.error || 'Server settings are unavailable. Reload the EA tab.');
    if (source === 'autosbc-server-info-request') {
      const current = await chrome.runtime.sendMessage({type:'autosbc-server-info'});
      if (current?.revision !== pinned.revision) throw new Error('Server settings changed. Stop the run and reload the EA tab before continuing.');
      window.postMessage({source:responseSource,id,...pinned},location.origin); return;
    }
    const response = await chrome.runtime.sendMessage({type:'autosbc-local-http',path,method,data,timeout,revision:pinned.revision});
    window.postMessage({source:responseSource,id,...response},location.origin);
  } catch (error) {
    window.postMessage({source:responseSource,id,error:error.message},location.origin);
  }
});
