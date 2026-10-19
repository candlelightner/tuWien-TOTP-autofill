import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../src/totp.js", import.meta.url), "utf8"));
const { TOTP } = globalThis;

function toBase32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

// RFC 6238, Appendix B
const SEEDS = {
  SHA1: toBase32(Buffer.from("12345678901234567890")),
  SHA256: toBase32(Buffer.from("12345678901234567890123456789012")),
  SHA512: toBase32(Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"))
};
const VECTORS = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"]
];

test("RFC 6238 test vectors (SHA1, SHA256, SHA512)", async () => {
  for (const [time, sha1, sha256, sha512] of VECTORS) {
    for (const [algorithm, expected] of [["SHA1", sha1], ["SHA256", sha256], ["SHA512", sha512]]) {
      const { code } = await TOTP.generate({ secret: SEEDS[algorithm], digits: 8, period: 30, algorithm }, time * 1000);
      assert.equal(code, expected, `${algorithm} @ ${time}`);
    }
  }
});

test("remainingMs counts down to the next period", async () => {
  const cfg = { secret: SEEDS.SHA1, digits: 6, period: 30, algorithm: "SHA1" };
  assert.equal((await TOTP.generate(cfg, 30_000)).remainingMs, 30_000);
  assert.equal((await TOTP.generate(cfg, 59_000)).remainingMs, 1_000);
});

test("parses otpauth URIs and drops issuer/label", () => {
  const cfg = TOTP.parseInput(
    "otpauth://totp/TU%20Wien:e01234567%40student.tuwien.ac.at?issuer=TU%20Wien&secret=jbsw y3dp-ehpk3pxp&digits=8&period=60&algorithm=sha-256"
  );
  assert.deepEqual(cfg, { secret: "JBSWY3DPEHPK3PXP", digits: 8, period: 60, algorithm: "SHA256" });
});

test("accepts a bare secret with spaces and padding", () => {
  assert.deepEqual(TOTP.parseInput("  jbsw y3dp ehpk 3pxp== \n"), {
    secret: "JBSWY3DPEHPK3PXP",
    digits: 6,
    period: 30,
    algorithm: "SHA1"
  });
});

test("rejects invalid input without echoing the secret", () => {
  const bad = [
    ["", /eingeben/],
    ["otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP", /HOTP/],
    ["otpauth://totp/x?issuer=a", /secret-Parameter/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0", /Periode/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=abc", /Periode/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=100", /Stellenanzahl/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5", /Algorithmus/],
    ["JBSWY3DP", /zu kurz/],
    ["JBSWY3DPEHPK3PX1", /ungültige Zeichen/]
  ];
  for (const [input, message] of bad) {
    assert.throws(() => TOTP.parseInput(input), (err) => err instanceof TOTP.TotpError && message.test(err.message), input);
  }
  assert.throws(() => TOTP.parseInput("JBSWY3DPEHPK3PX1"), (err) => !err.message.includes("1"));
});

test("generate() validates stored config too", async () => {
  await assert.rejects(TOTP.generate({ secret: SEEDS.SHA1, digits: 6, period: 0, algorithm: "SHA1" }), TOTP.TotpError);
});
