/* global TOTP */
"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const IDP_ORIGINS = ["https://idp.zid.tuwien.ac.at/simplesaml/module.php/core/loginuserpass*"];

const $ = (id) => document.getElementById(id);

let previewTimer = null;

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

async function loadState() {
  const { config, mode } = await api.storage.local.get({ config: null, mode: "auto" });

  const state = $("secret-state");
  if (config) {
    state.textContent = `✓ Secret gespeichert (${config.digits} Stellen, ${config.period} s, ${config.algorithm})`;
    state.classList.add("ok");
  } else {
    state.textContent = "Noch kein Secret gespeichert.";
    state.classList.remove("ok");
  }
  $("delete").hidden = !config;
  $("preview-card").hidden = !config;
  if (!config) hidePreview();

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === (mode === "manual" ? "manual" : "auto");
  }
}

async function checkPermission() {
  if (!api.permissions?.contains) return;
  try {
    const granted = await api.permissions.contains({ origins: IDP_ORIGINS });
    $("permission-warning").hidden = granted;
  } catch {
    $("permission-warning").hidden = true;
  }
}

async function onSave(event) {
  event.preventDefault();
  const input = $("secret");

  let config;
  try {
    config = TOTP.parseInput(input.value);
    await TOTP.generate(config); // make sure WebCrypto accepts it
  } catch (err) {
    setStatus(err instanceof TOTP.TotpError ? err.message : "Das Secret konnte nicht verarbeitet werden.", true);
    return;
  }

  await api.storage.local.set({ config });
  input.value = "";
  setStatus("Gespeichert. Bitte den Code unten mit der Authenticator-App vergleichen.");
  await loadState();
  showPreview();
}

let deleteArmedUntil = 0;

async function onDelete() {
  const button = $("delete");
  if (Date.now() > deleteArmedUntil) {
    deleteArmedUntil = Date.now() + 5000;
    button.textContent = "Wirklich löschen? Nochmal klicken";
    setTimeout(() => (button.textContent = "Secret löschen"), 5000);
    return;
  }
  deleteArmedUntil = 0;
  button.textContent = "Secret löschen";
  await api.storage.local.remove("config");
  TOTP.clearKeyCache();
  setStatus("Secret gelöscht.");
  await loadState();
}

async function renderPreview() {
  const { config } = await api.storage.local.get({ config: null });
  if (!config) return hidePreview();
  try {
    const { code, remainingMs } = await TOTP.generate(config);
    $("code").textContent = code;
    $("countdown").textContent = `noch ${Math.ceil(remainingMs / 1000)} s`;
  } catch {
    $("code").textContent = "—";
    $("countdown").textContent = "Konfiguration ungültig";
  }
}

function showPreview() {
  $("preview").hidden = false;
  $("toggle-preview").textContent = "Code ausblenden";
  renderPreview();
  clearInterval(previewTimer);
  previewTimer = setInterval(renderPreview, 1000);
}

function hidePreview() {
  clearInterval(previewTimer);
  previewTimer = null;
  $("preview").hidden = true;
  $("code").textContent = "";
  $("toggle-preview").textContent = "Aktuellen Code anzeigen";
}

async function onGrant() {
  try {
    const granted = await api.permissions.request({ origins: IDP_ORIGINS });
    if (!granted) $("grant-hint").hidden = false;
  } catch {
    $("grant-hint").hidden = false;
  }
  await checkPermission();
}

document.addEventListener("DOMContentLoaded", () => {
  $("secret-form").addEventListener("submit", onSave);
  $("delete").addEventListener("click", onDelete);
  $("grant").addEventListener("click", onGrant);
  $("toggle-preview").addEventListener("click", () => (previewTimer ? hidePreview() : showPreview()));

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", async () => {
      await api.storage.local.set({ mode: radio.value });
      setStatus(radio.value === "manual" ? "Manueller Modus aktiv." : "Automatischer Modus aktiv.");
    });
  }

  // Hide the code when the page is hidden (screen sharing, tab switch).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hidePreview();
  });

  loadState();
  checkPermission();
});
