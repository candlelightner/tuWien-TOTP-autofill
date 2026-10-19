/*
 * Background script / service worker.
 *
 * This is the only extension context (besides the options page) that ever
 * reads the TOTP secret. Content scripts only receive the finished code, and
 * only for the top-level frame of the TU Wien IdP.
 */
/* global TOTP */
"use strict";

const api = globalThis.browser ?? globalThis.chrome;

// Keep in sync with SITE in scripts/build.mjs (content_scripts.matches).
// TU Wien's IdP renders username, password and #totp on this single page.
const IDP_ORIGIN = "https://idp.zid.tuwien.ac.at";
const LOGIN_PATH = "/simplesaml/module.php/core/loginuserpass";
const MANUAL_ARM_MS = 15_000;

/** tabId -> expiry timestamp; set when the user presses the shortcut. */
const armedTabs = new Map();

function isAllowedSender(sender) {
  if (!sender || sender.id !== api.runtime.id || !sender.tab) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;

  let url;
  try {
    url = new URL(sender.url || sender.tab.url || "");
  } catch {
    return false;
  }
  return url.origin === IDP_ORIGIN && url.pathname === LOGIN_PATH;
}

async function getSettings() {
  const { config, mode } = await api.storage.local.get({ config: null, mode: "auto" });
  return { config, mode: mode === "manual" ? "manual" : "auto" };
}

function consumeArm(tabId) {
  const expiry = armedTabs.get(tabId);
  armedTabs.delete(tabId);
  return expiry !== undefined && expiry > Date.now();
}

async function handleGetCode(message, sender) {
  if (!isAllowedSender(sender)) return { ok: false, reason: "forbidden" };

  const { config, mode } = await getSettings();
  if (!config) return { ok: false, reason: "not-configured" };

  const userTriggered = message.trigger === "user" && consumeArm(sender.tab.id);
  if (mode === "manual" && !userTriggered) return { ok: false, reason: "manual-mode" };

  try {
    const { code, remainingMs } = await TOTP.generate(config);
    return { ok: true, code, remainingMs, mode };
  } catch {
    // Never forward error details - they could be derived from the secret.
    return { ok: false, reason: "invalid-config" };
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "getCode") return false;
  handleGetCode(message, sender).then(sendResponse, () => sendResponse({ ok: false, reason: "error" }));
  return true; // keep the channel open for the async response (Chrome/Safari)
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.config) TOTP.clearKeyCache();
});

if (api.commands?.onCommand) {
  api.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "fill-totp") return;
    try {
      const target = tab ?? (await api.tabs.query({ active: true, currentWindow: true }))[0];
      if (!target?.id) return;
      armedTabs.set(target.id, Date.now() + MANUAL_ARM_MS);
      await api.tabs.sendMessage(target.id, { type: "fillNow" }, { frameId: 0 });
    } catch {
      // No content script in this tab (not the IdP) - nothing to do.
    }
  });
}

api.tabs?.onRemoved?.addListener((tabId) => armedTabs.delete(tabId));
