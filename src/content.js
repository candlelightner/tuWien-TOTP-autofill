/*
 * Content script for the TU Wien IdP.
 *
 * It never sees the TOTP secret: it asks the background script for the
 * current code and fills it into the `#totp` input of the top-level frame.
 * In "auto" mode it fills once when the field appears (and refreshes the
 * value when the code rolls over, as long as nobody changed it). In "manual"
 * mode it only fills after the keyboard shortcut was pressed.
 */
"use strict";

(() => {
  if (window.top !== window) return; // top-level frame only

  const api = globalThis.browser ?? globalThis.chrome;

  const FIELD_ID = "totp";
  const WATCH_TIMEOUT_MS = 120_000; // stop looking for the field after 2 minutes
  const MAX_REFRESHES = 10; // refresh a rolled-over code at most ~5 minutes
  const ALLOWED_TYPES = new Set(["text", "tel", "number", "password"]);

  let lastFilled = null;
  let refreshCount = 0;
  let refreshTimer = null;
  let observer = null;
  let watchTimer = null;
  let stopped = false;
  let busy = false;

  function isVisible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function findField() {
    const el = document.getElementById(FIELD_ID);
    if (!(el instanceof HTMLInputElement)) return null;
    if (!ALLOWED_TYPES.has(el.type) || el.disabled || el.readOnly || !isVisible(el)) return null;

    // Never fill a field inside a form that posts to a different origin.
    const action = el.form?.getAttribute("action");
    if (action) {
      try {
        if (new URL(action, location.href).origin !== location.origin) return null;
      } catch {
        return null;
      }
    }
    return el;
  }

  function setValue(field, value) {
    // Use the native setter so frameworks (React & co.) notice the change.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    clearTimeout(watchTimer);
  }

  function stopAll() {
    stopped = true;
    stopWatching();
    clearTimeout(refreshTimer);
  }

  async function requestCode(trigger) {
    try {
      return await api.runtime.sendMessage({ type: "getCode", trigger });
    } catch {
      return null; // extension reloaded/updated - stay quiet
    }
  }

  function scheduleRefresh(field, remainingMs) {
    clearTimeout(refreshTimer);
    if (refreshCount >= MAX_REFRESHES) return;

    refreshTimer = setTimeout(async () => {
      if (stopped || !field.isConnected || field.value !== lastFilled) return;
      if (document.visibilityState !== "visible") {
        // Refresh as soon as the tab is visible again.
        document.addEventListener("visibilitychange", () => scheduleRefresh(field, 0), { once: true });
        return;
      }
      refreshCount++;
      await fill("refresh");
    }, Math.max(remainingMs, 0) + 250);
  }

  async function fill(trigger) {
    if (busy) return;
    const field = findField();
    if (!field) return;

    // Never overwrite something the user typed (unless explicitly asked to).
    if (trigger !== "user" && field.value !== "" && field.value !== lastFilled) return;

    busy = true;
    try {
      const response = await requestCode(trigger === "user" ? "user" : "auto");
      if (!response || !response.ok) {
        if (response?.reason === "manual-mode" || response?.reason === "not-configured") stopWatching();
        return;
      }

      // Re-check after the async round trip.
      if (!field.isConnected) return;
      if (trigger !== "user" && field.value !== "" && field.value !== lastFilled) return;

      setValue(field, response.code);
      lastFilled = response.code;
      stopWatching();

      field.form?.addEventListener("submit", stopAll, { once: true });
      if (response.mode === "auto") scheduleRefresh(field, response.remainingMs);
    } finally {
      busy = false;
    }
  }

  function startWatching() {
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        fill("auto");
      }, 100);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    watchTimer = setTimeout(stopWatching, WATCH_TIMEOUT_MS);
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "fillNow") {
      stopped = false;
      fill("user");
    }
    return false;
  });

  startWatching();
  fill("auto");
})();
