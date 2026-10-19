# TOTP Autofill für TU Wien

Browser extension that generates the TOTP code for the TU Wien login
(`idp.zid.tuwien.ac.at`) locally and fills it in.

Supports **Firefox** (desktop + Android), **Chrome/Chromium/Edge**, and
**Safari on macOS and iOS/iPadOS**.

Fork of [Fighter077/tuWien-TOTP-autofill](https://github.com/Fighter077/tuWien-TOTP-autofill)
with a security-focused rewrite (v2).

> [!WARNING]
> Storing the TOTP secret in the browser turns two-factor authentication into
> effectively **one factor on this device**. Anyone who can read your browser
> profile can generate codes indefinitely. If you suspect the secret leaked,
> re-enrol TOTP in the TU portal. Check whether this is compatible with TU
> Wien's IT usage rules before relying on it.

## What changed in v2

| Area | v1 | v2 |
|---|---|---|
| Secret exposure | Content script loaded the raw secret into the IdP page process | Only the background script reads it; content script receives just the 6-digit code after the background checks sender origin and frame |
| Scope | Whole IdP host (`https://idp…/*`) + host permission | Only `/simplesaml/module.php/core/loginuserpass*`, top frame only, no host permission (content-script match only), refuses forms posting cross-origin |
| Fill behaviour | `MutationObserver` + `setInterval(5s)` forever, overwrote the field each time | Fills once, refreshes only when the code rolls over **and** the field still holds our value, stops on submit/after 5 min, never overwrites user input |
| Manual mode | – | Optional: fill only after <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> (prevents a page script from obtaining codes by creating `#totp`) |
| Stored data | Raw `otpauth://` URI incl. issuer + username | Normalized `{secret, digits, period, algorithm}` only |
| Validation | None (failures only as console errors on the IdP page) | Strict validation on save (totp only, base32, ≥16 chars, digits 6–8, period 1–300 s, SHA1/256/512) and a live preview to compare with your app |
| Options UI | Secret shown in plaintext textarea and re-displayed | Password input, never re-displayed, delete button, preview on demand and hidden when the tab is hidden |
| Bugs | Padding stripped before whitespace, only first `-` removed from algorithm, error messages echoed secret characters | Fixed; covered by tests |
| Code base | Two copy-pasted folders + committed zips, MV2 for Firefox | Single `src/`, MV3 for all targets, zips built by CI |
| Tests | – | RFC 6238 test vectors + parser edge cases (`npm test`) |

## Install

### Firefox / Chrome (from source)

```sh
npm ci
npm run package       # -> dist/tuwien-totp-autofill-{firefox,chrome}-<version>.zip
```

- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
  `dist/firefox/manifest.json`. For a permanent install, sign it as an
  *unlisted* add-on (see CI below) and install the signed `.xpi`.
- **Chrome:** `chrome://extensions` → *Developer mode* → *Load unpacked* → `dist/chrome`.

Then open the extension options and paste your `otpauth://totp/...` URL or
base32 secret. Compare the preview code with your authenticator app.

Firefox MV3 may ask you to grant access to `idp.zid.tuwien.ac.at`; the options
page shows a button for that if needed.

### Safari (macOS + iOS)

Safari extensions must be wrapped in an app, which requires **macOS with Xcode 15+**:

```sh
npm run safari
open "safari/TU TOTP Autofill/TU TOTP Autofill.xcodeproj"
```

- **macOS:** run the *(macOS)* scheme, then enable the extension in
  Safari → Settings → Extensions. Without a paid developer account enable
  Safari → Develop → *Allow Unsigned Extensions* (resets on each Safari restart),
  or sign with your (free) Apple ID team in Xcode.
- **iOS/iPadOS:** select your device, set your Apple ID team under
  *Signing & Capabilities* for both the app and the extension target, and run.
  Free Apple IDs produce builds that expire after 7 days; a paid Apple
  Developer account (or TestFlight/App Store) is needed for permanent installs.
  Enable it in Settings → Apps → Safari → Extensions and allow access to
  `idp.zid.tuwien.ac.at`.
- On iOS there are no keyboard shortcuts, so use automatic mode. Settings are
  available from the extension's popup in Safari's **aA** / puzzle menu.

## Development

```sh
npm test          # unit tests (RFC 6238 vectors, parser)
npm run lint      # web-ext lint on the Firefox build
npm run build     # dist/{firefox,chrome,safari}
```

Layout:

```
src/
  totp.js            TOTP core (shared by background, options, tests)
  background.js      holds the secret, answers code requests from the IdP tab
  service-worker.js  Chrome/Safari loader for totp.js + background.js
  content.js         finds #totp and fills it - never sees the secret
  options.{html,js,css}
scripts/build.mjs    per-browser manifests (Firefox: event page; Chrome/Safari: service worker; Safari: popup)
scripts/build-safari.sh  wraps dist/safari into an Xcode project
```

The URL scope lives in `scripts/build.mjs` (`SITE`), `src/background.js`
(`IDP_ORIGIN`, `LOGIN_PATH`) and `src/options.js` (`IDP_ORIGINS`) - keep them
in sync.

### CI

`.github/workflows/ci.yml` runs tests and lint, builds the zips, and builds the
Safari macOS and iOS apps (unsigned) on a macOS runner. Pushing a `v*` tag
creates a GitHub release with the zips and `SHA256SUMS`. If the repository
secrets `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` are set, the Firefox build is also
signed as an unlisted add-on that you can install permanently.

## Security notes

- Consider disabling automatic updates for this add-on, or building it yourself
  from a commit you reviewed.
- Content scripts technically have access to `storage.local` in Chrome and
  Firefox. v2 never reads the secret there, which limits accidental exposure,
  but it is not a hard isolation boundary against a compromised renderer.
- The secret is not encrypted at rest. A passphrase-protected mode
  (PBKDF2 → AES-GCM, unlocked per browser session) would add a knowledge
  factor back and is a possible future addition.

## License

The upstream project does not include a license (AMO lists it as *All Rights
Reserved*). Changes in this fork are offered under the same terms until the
upstream author chooses a license.
