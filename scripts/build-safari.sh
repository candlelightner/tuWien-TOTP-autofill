#!/bin/sh
# Wraps dist/safari into an Xcode project (macOS + iOS app with the Safari
# Web Extension inside). Requires macOS with Xcode 15+.
#
#   npm run safari                    # converts and opens nothing
#   open safari/"TU TOTP Autofill"/"TU TOTP Autofill.xcodeproj"
set -eu

cd "$(dirname "$0")/.."

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found - the Safari build needs macOS with Xcode installed." >&2
  exit 1
fi

[ -f dist/safari/manifest.json ] || node scripts/build.mjs safari

APP_NAME="TU TOTP Autofill"
BUNDLE_ID="${SAFARI_BUNDLE_ID:-io.github.candlelightner.tuwien-totp-autofill}"

xcrun safari-web-extension-converter dist/safari \
  --project-location safari \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

echo
echo "Xcode project: safari/$APP_NAME/$APP_NAME.xcodeproj"
echo "Schemes: \"$APP_NAME (macOS)\" and \"$APP_NAME (iOS)\""
