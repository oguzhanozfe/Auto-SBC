/* Native SBC entrypoint using the MIT upstream EA detail-panel adapter. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoSBCNative = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BUTTON_ID = 'autosbc-native-solve';
  const contextKey = context => context && context.setId != null && context.challengeId != null
    ? `${context.setId}:${context.challengeId}` : null;

  function install(options) {
    const document = options.document;
    let prototype, originalInit, wrappedInit, panel, pendingView, anchor, button;
    let observedKey = null, stableObservations = 0, pending = false, disposed = false;
    let previousContext = null;

    function readContext() {
      if (!anchor?.isConnected || !button?.isConnected) return null;
      try { return options.resolveContext(panel) || null; } catch { return null; }
    }
    function gate(context) {
      if (!contextKey(context)) return { ready: false, reason: 'EA görevi yükleniyor…' };
      try { return options.getGate(context) || { ready: false, reason: 'Hazırlanıyor…' }; }
      catch { return { ready: false, reason: 'EA görevi henüz hazır değil.' }; }
    }
    function showDisabled(reason) {
      if (!button) return;
      button.disabled = true;
      button.textContent = pending ? 'Auto-SBC · Çözülüyor…' : 'Auto-SBC · Hazırlanıyor…';
      button.title = reason || 'EA görevi yükleniyor…';
    }
    function notifyNavigation(context) {
      const next = contextKey(context);
      if (previousContext && next !== previousContext) options.onContextChanged?.(previousContext, next);
      previousContext = next;
    }
    async function clicked(event) {
      event.preventDefault?.();
      const context = readContext(), key = contextKey(context), ready = gate(context);
      if (pending || button.disabled || !key || key !== observedKey || stableObservations < 2 || !ready.ready) {
        showDisabled(ready.reason || 'Görev değişti; yeniden hazırlanıyor.');
        tick();
        return;
      }
      // The current IDs are captured only at the user's click, not panel init.
      pending = true;
      showDisabled('Çözüm hazırlanıyor; sonucu incelemeden kadro uygulanmaz.');
      try { await options.onSolveCurrent({ ...context }); }
      catch (error) { options.onError?.(error); }
      finally { pending = false; stableObservations = 0; tick(); }
    }
    function mount(view) {
      if (disposed) return;
      const exchange = view?._btnExchange?.__root;
      if (!exchange?.parentNode) return;
      if (!button) {
        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'btn-standard';
        button.setAttribute('data-autosbc-native', 'true');
        showDisabled('EA görevi yükleniyor…');
        // Bind before insertion: a visible button must never lack its handler.
        button.addEventListener('click', clicked);
      }
      const changed = anchor !== exchange || panel !== view;
      panel = view;
      anchor = exchange;
      if (changed) { stableObservations = 0; observedKey = null; showDisabled(); }
      if (button.parentNode !== exchange.parentNode || button.previousSibling !== exchange) {
        exchange.parentNode.insertBefore(button, exchange.nextSibling);
      }
      if (changed) options.onMount?.();
    }
    function hook() {
      if (prototype || disposed) return;
      const target = options.getPrototype();
      if (!target || typeof target.init !== 'function') return;
      prototype = target;
      originalInit = target.init;
      wrappedInit = function (...args) {
        const result = originalInit.apply(this, args);
        pendingView = this;
        try { mount(this); } catch (error) { options.onError?.(error); }
        return result;
      };
      target.init = wrappedInit;
    }
    function tick() {
      if (disposed) return;
      hook();
      if (pendingView && (!button || panel !== pendingView || anchor !== pendingView?._btnExchange?.__root || !button.parentNode)) {
        try { mount(pendingView); } catch (error) { options.onError?.(error); }
      }
      if (!button) return;
      const context = readContext(), key = contextKey(context);
      notifyNavigation(context);
      if (key && key === observedKey) stableObservations++;
      else { observedKey = key; stableObservations = key ? 1 : 0; }
      const ready = gate(context);
      if (pending || !ready.ready || stableObservations < 2) showDisabled(ready.reason);
      else {
        button.disabled = false;
        button.textContent = 'Auto-SBC ile çöz';
        button.title = 'Bu görevi yerel motorla çöz; kadroyu uygulamadan önce incele.';
      }
    }
    hook();
    const stop = options.schedule ? options.schedule(tick) : (() => {
      const timer = setInterval(tick, 250);
      timer?.unref?.();
      return () => clearInterval(timer);
    })();
    return {
      tick,
      dispose() {
        disposed = true; stop?.(); button?.remove();
        // Do not remove another extension's wrapper installed after ours.
        if (prototype?.init === wrappedInit) prototype.init = originalInit;
      }
    };
  }
  return { install, contextKey, BUTTON_ID };
});
