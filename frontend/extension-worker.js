/* Network bridge restricted to the local companion API, MIT. */
'use strict';
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'autosbc-local-http') return false;
  const origin = sender.tab?.url;
  if (!origin || !/^https:\/\/www\.(ea\.com|easports\.com)\//.test(origin)) return false;
  const paths = { '/health': 'GET', '/api/players': 'GET', '/api/concepts': 'POST', '/api/solve/jobs': 'POST' };
  let url;
  try { url = new URL(message.path, 'http://127.0.0.1:8000'); } catch { return false; }
  const permittedMethod = /^\/api\/solve\/jobs\/[a-zA-Z0-9-]+$/.test(url.pathname) ? 'GET' : paths[url.pathname];
  if (url.origin !== 'http://127.0.0.1:8000' || permittedMethod !== message.method) {
    respond({ error: 'Unsupported local endpoint.' }); return false;
  }
  const controller = new AbortController();
  const timeout = Math.min(Math.max(Number(message.timeout) || 15000, 1000), 345000);
  const timer = setTimeout(() => controller.abort(), timeout);
  fetch(url.href, { method: message.method, headers: { 'Content-Type': 'application/json' },
    credentials: 'omit', signal: controller.signal,
    body: message.data === undefined ? undefined : JSON.stringify(message.data)
  }).then(async response => {
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { throw new Error('Local server did not return JSON.'); }
    respond({ ok: response.ok, status: response.status, body });
  }).catch(error => respond({ error: error.name === 'AbortError' ? 'Local solver request timed out.' : 'Cannot reach the local solver. Start the server and retry.' }))
    .finally(() => clearTimeout(timer));
  return true;
});
