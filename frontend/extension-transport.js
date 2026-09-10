/* Extension-owned server configuration. No EA credentials, MIT. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCTransport = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:8000';
  const STORAGE_KEY = 'autosbc.server.v1';
  function httpsOrigin(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter your HTTPS server origin.');
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('Enter your HTTPS server origin.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash || !url.hostname || url.hostname.includes('*')) {
      throw new Error('Use an HTTPS origin with no path, credentials, query or custom port.');
    }
    return url.origin;
  }
  function config(value) {
    if (value === undefined) return { mode: 'local', origin: LOCAL, revision: 'local-default-v1' };
    if (!value || typeof value !== 'object' || typeof value.revision !== 'string' ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(value.revision)) throw new Error('Server settings are unreadable. Open extension settings.');
    if (value.mode === 'local' && value.origin === LOCAL) return { mode: 'local', origin: LOCAL, revision: value.revision };
    if (value.mode !== 'hosted' || value.consent !== true ||
        typeof value.token !== 'string' || !/^[a-zA-Z0-9_-]{32,512}$/.test(value.token)) {
      throw new Error('Choose a server and enter its access token in extension settings.');
    }
    return { mode: 'hosted', origin: httpsOrigin(value.origin), token: value.token, consent: true, revision: value.revision };
  }
  function info(value) {
    const selected = config(value);
    return { mode: selected.mode, origin: selected.origin, configured: true, revision: selected.revision };
  }
  function eaSender(sender, extensionId) {
    if (!sender || sender.id !== extensionId || sender.frameId !== 0 || !sender.tab || typeof sender.url !== 'string') return false;
    try {
      const url = new URL(sender.url);
      return url.protocol === 'https:' && ['www.ea.com', 'www.easports.com'].includes(url.host) &&
        /^\/(?:[^/]+\/)?ea-sports-fc\/ultimate-team\/web-app\//.test(url.pathname);
    } catch { return false; }
  }
  function request(value, message) {
    const selected = config(value);
    if (message.revision !== selected.revision) throw new Error('Server settings changed. Stop the run and reload the EA tab before continuing.');
    if (typeof message.path !== 'string' || !message.path.startsWith('/') || message.path.startsWith('//') ||
        /[\\\x00-\x20#]/.test(message.path)) throw new Error('Unsupported solver endpoint.');
    const url = new URL(message.path, selected.origin);
    const expected = url.pathname === '/health' ? 'GET' : url.pathname === '/api/solve/jobs' ? 'POST' :
      /^\/api\/solve\/jobs\/[a-zA-Z0-9-]+$/.test(url.pathname) ? 'GET' : null;
    if (url.origin !== selected.origin || expected !== message.method ||
        (url.search && url.pathname !== '/health') ||
        [...url.searchParams.keys()].some(key => !['gameYear','platform'].includes(key))) throw new Error('Unsupported solver endpoint.');
    if (message.method === 'GET' && message.data !== undefined) throw new Error('Read requests cannot contain club data.');
    const headers = { 'Content-Type': 'application/json' };
    if (selected.mode === 'hosted') headers.Authorization = `Bearer ${selected.token}`;
    return { origin: selected.origin, mode: selected.mode, url: url.href, options: {
      method: message.method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
      body: message.data === undefined ? undefined : JSON.stringify(message.data)
    } };
  }
  return { LOCAL, STORAGE_KEY, httpsOrigin, config, info, eaSender, request };
});
