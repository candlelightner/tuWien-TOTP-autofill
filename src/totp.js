/*
 * TOTP core (RFC 6238 / RFC 4226) - no dependencies, WebCrypto only.
 *
 * Loaded as a classic script by the background script, the options page and
 * the unit tests. It exposes a single global: `TOTP`.
 */
(function (root) {
  "use strict";

  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const ALGORITHMS = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
  const DIGITS = [6, 7, 8];
  const MIN_SECRET_CHARS = 16; // 80 bit - the minimum used by real-world issuers
  const MIN_PERIOD = 1;
  const MAX_PERIOD = 300;

  class TotpError extends Error {}

  /** Removes whitespace, dashes and padding and upper-cases a base32 string. */
  function normalizeBase32(input) {
    return String(input).replace(/[\s-]+/g, "").replace(/=+$/, "").toUpperCase();
  }

  /** Decodes a (normalized) base32 string. Never echoes secret characters in errors. */
  function base32ToBytes(base32) {
    const cleaned = normalizeBase32(base32);
    let buffer = 0;
    let bitCount = 0;
    const out = [];

    for (const char of cleaned) {
      const value = BASE32_ALPHABET.indexOf(char);
      if (value === -1) {
        throw new TotpError("Das Secret enthält ungültige Zeichen (erlaubt: A–Z, 2–7).");
      }
      buffer = (buffer << 5) | value;
      bitCount += 5;
      if (bitCount >= 8) {
        bitCount -= 8;
        out.push((buffer >>> bitCount) & 0xff);
      }
    }
    return new Uint8Array(out);
  }

  function normalizeAlgorithm(algorithm) {
    const key = String(algorithm || "SHA1").replace(/-/g, "").toUpperCase();
    if (!ALGORITHMS[key]) {
      throw new TotpError("Nicht unterstützter Algorithmus (erlaubt: SHA1, SHA256, SHA512).");
    }
    return key;
  }

  function parseIntStrict(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    return /^\d+$/.test(String(value)) ? Number(value) : NaN;
  }

  /**
   * Validates a config object and returns a normalized copy:
   * { secret, digits, period, algorithm }.
   */
  function validateConfig(config) {
    if (!config || typeof config !== "object") {
      throw new TotpError("Keine Konfiguration vorhanden.");
    }

    const secret = normalizeBase32(config.secret || "");
    if (secret.length < MIN_SECRET_CHARS) {
      throw new TotpError(`Das Secret ist zu kurz (mindestens ${MIN_SECRET_CHARS} Zeichen).`);
    }
    base32ToBytes(secret); // throws on invalid characters

    const digits = parseIntStrict(config.digits, 6);
    if (!DIGITS.includes(digits)) {
      throw new TotpError("Ungültige Stellenanzahl (erlaubt: 6, 7 oder 8).");
    }

    const period = parseIntStrict(config.period, 30);
    if (!Number.isInteger(period) || period < MIN_PERIOD || period > MAX_PERIOD) {
      throw new TotpError(`Ungültige Periode (erlaubt: ${MIN_PERIOD}–${MAX_PERIOD} Sekunden).`);
    }

    return { secret, digits, period, algorithm: normalizeAlgorithm(config.algorithm) };
  }

  /**
   * Parses either an `otpauth://totp/...` URI or a bare base32 secret.
   * Only the cryptographic parameters are kept - issuer and account label
   * (which usually contain the username) are intentionally discarded.
   */
  function parseInput(input) {
    const raw = String(input || "").trim();
    if (!raw) throw new TotpError("Bitte eine otpauth-URL oder ein Base32-Secret eingeben.");

    if (/^otpauth:/i.test(raw)) {
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw new TotpError("Die otpauth-URL ist ungültig.");
      }
      // new URL("otpauth://totp/x") -> host "totp" (spec: non-special scheme)
      const type = (url.host || url.pathname.replace(/^\/+/, "").split("/")[0]).toLowerCase();
      if (type !== "totp") {
        throw new TotpError("Nur otpauth://totp/ wird unterstützt (kein HOTP).");
      }
      const params = url.searchParams;
      if (!params.get("secret")) {
        throw new TotpError("In der otpauth-URL fehlt der secret-Parameter.");
      }
      return validateConfig({
        secret: params.get("secret"),
        digits: params.get("digits"),
        period: params.get("period"),
        algorithm: params.get("algorithm")
      });
    }

    return validateConfig({ secret: raw });
  }

  function counterBytes(counter) {
    const bytes = new Uint8Array(8);
    let value = BigInt(counter);
    for (let i = 7; i >= 0; i--) {
      bytes[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return bytes;
  }

  const keyCache = new Map();

  async function importKey(secret, algorithm) {
    const cacheKey = `${algorithm}:${secret}`;
    let key = keyCache.get(cacheKey);
    if (!key) {
      key = await root.crypto.subtle.importKey(
        "raw",
        base32ToBytes(secret),
        { name: "HMAC", hash: ALGORITHMS[algorithm] },
        false, // non-extractable
        ["sign"]
      );
      keyCache.clear(); // only ever keep the current secret
      keyCache.set(cacheKey, key);
    }
    return key;
  }

  /**
   * Generates the code for `timeMs` (defaults to now).
   * Returns { code, remainingMs } where remainingMs is the time until the
   * code rolls over.
   */
  async function generate(config, timeMs = Date.now()) {
    const cfg = validateConfig(config);
    const periodMs = cfg.period * 1000;
    const counter = Math.floor(timeMs / periodMs);

    const key = await importKey(cfg.secret, cfg.algorithm);
    const hmac = new Uint8Array(await root.crypto.subtle.sign("HMAC", key, counterBytes(counter)));

    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3];

    return {
      code: String(binary % 10 ** cfg.digits).padStart(cfg.digits, "0"),
      remainingMs: periodMs - (timeMs % periodMs)
    };
  }

  function clearKeyCache() {
    keyCache.clear();
  }

  root.TOTP = Object.freeze({
    TotpError,
    parseInput,
    validateConfig,
    generate,
    clearKeyCache,
    _internal: Object.freeze({ base32ToBytes, normalizeBase32 })
  });
})(globalThis);
