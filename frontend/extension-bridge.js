/* Isolated-world localhost transport. No access to cookies or EA credentials. */
'use strict';
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'autosbc-local-request') return;
  const { id, path, method, data, timeout } = event.data;
  if (typeof id !== 'string' || id.length > 100) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'autosbc-local-http', path, method, data, timeout });
    window.postMessage({ source: 'autosbc-local-response', id, ...response }, location.origin);
  } catch (error) {
    window.postMessage({ source: 'autosbc-local-response', id, error: error.message }, location.origin);
  }
});
