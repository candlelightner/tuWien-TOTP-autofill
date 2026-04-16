const FIXED_SELECTOR = "#totp";

async function getSettings() {
  return await browser.storage.local.get({
    otpauth: ""
  });
}

function parseOtpAuthInput(input) {
  const raw = input.trim();

  if (!raw) {
    throw new Error("Kein OTPAuth-Wert angegeben.");
  }

  if (raw.startsWith("otpauth://")) {
    const url = new URL(raw);
    const secret = url.searchParams.get("secret");
    const digits = Number(url.searchParams.get("digits") || 6);
    const period = Number(url.searchParams.get("period") || 30);
    const algorithm = (url.searchParams.get("algorithm") || "SHA1").toUpperCase();

    if (!secret) {
      throw new Error("In der OTPAuth-URL fehlt der secret-Parameter.");
    }

    return {
      secret,
      digits,
      period,
      algorithm
    };
  }

  return {
    secret: raw,
    digits: 6,
    period: 30,
    algorithm: "SHA1"
  };
}

function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");

  let bits = "";
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val === -1) {
      throw new Error(`Ungültiges Base32-Zeichen: ${char}`);
    }
    bits += val.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

function numberTo8ByteArray(num) {
  const arr = new Uint8Array(8);
  let value = BigInt(num);

  for (let i = 7; i >= 0; i--) {
    arr[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return arr;
}

function normalizeAlgorithm(algo) {
  const a = algo.replace("-", "").toUpperCase();

  if (a === "SHA1") return "SHA-1";
  if (a === "SHA256") return "SHA-256";
  if (a === "SHA512") return "SHA-512";

  throw new Error(`Nicht unterstützter Algorithmus: ${algo}`);
}

async function generateTotp(secret, digits = 6, period = 30, algorithm = "SHA1") {
  const keyBytes = base32ToBytes(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBytes = numberTo8ByteArray(counter);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: normalizeAlgorithm(algorithm) },
    false,
    ["sign"]
  );

  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, counterBytes)
  );

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % (10 ** digits)).padStart(digits, "0");
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function fillField(field, otp) {
  setNativeValue(field, otp);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function tryFill() {
  try {
    const { otpauth } = await getSettings();
    if (!otpauth) return;

    const field = document.querySelector(FIXED_SELECTOR);
    if (!field) return;

    const config = parseOtpAuthInput(otpauth);
    const otp = await generateTotp(
      config.secret,
      config.digits,
      config.period,
      config.algorithm
    );

    fillField(field, otp);
  } catch (err) {
    console.error("TOTP Autofill Fehler:", err);
  }
}

async function init() {
  await tryFill();

  const observer = new MutationObserver(() => {
    tryFill();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(() => {
    tryFill();
  }, 5000);
}

init();