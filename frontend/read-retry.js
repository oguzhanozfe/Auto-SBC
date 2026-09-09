/* Auto-SBC Local — one paced retry for explicitly allowed EA reads only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCReadRetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const READ_KINDS = new Set(['requestSets','requestChallengesForSet']);
  const DEFAULT_DELAY_MS = 60000, MAX_DELAY_SECONDS = 300, WAIT_CHUNK_MS = 500;
  const timer = ms => new Promise(resolve => setTimeout(resolve,ms));

  async function read({kind,request,guard,onWait,sleep=timer,now=()=>Date.now()} = {}) {
    if (!READ_KINDS.has(kind)) throw new Error('Only requestSets and requestChallengesForSet may use read retry.');
    if (typeof request !== 'function' || typeof guard !== 'function' || typeof sleep !== 'function' || typeof now !== 'function' ||
        onWait !== undefined && typeof onWait !== 'function') throw new Error('Invalid read retry callbacks.');
    const time = () => {
      const value = now();
      if (!Number.isFinite(value)) throw new Error('Read retry clock is unavailable.');
      return value;
    };
    for (let attempt=0;attempt<2;attempt++) {
      // Keep guards outside the request catch: a guard/progress failure must
      // never be interpreted as an EA rate-limit response.
      await guard();
      let result, rateLimit;
      try { result = await request(); }
      catch (error) {
        if (attempt !== 0 || error?.status !== 429) throw error;
        rateLimit = error;
      }
      if (!rateLimit) { await guard(); return result; }

      await guard();
      const seconds = rateLimit.retryAfterSeconds;
      if (typeof seconds === 'number' && seconds > MAX_DELAY_SECONDS) {
        const error = new Error('EA requested a retry delay longer than five minutes; automatic read retry stopped.', {cause:rateLimit});
        error.status = 429; error.retryAfterSeconds = seconds;
        throw error;
      }
      // EA's SBC service often omits Retry-After. Sixty seconds is our bounded
      // fallback, not a documented EA recovery guarantee.
      const delayMs = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_DELAY_MS;
      const deadline = time() + delayMs;
      for (;;) {
        await guard();
        const remainingMs = Math.max(0,deadline-time());
        if (onWait) await onWait({kind,attempt:2,delayMs,remainingMs});
        await guard();
        if (remainingMs === 0) break;
        await sleep(Math.min(WAIT_CHUNK_MS,remainingMs));
        await guard();
      }
    }
  }
  return Object.freeze({read});
});
