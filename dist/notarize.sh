#!/bin/bash
# Notarize + staple a Developer-ID-signed .app. Needs a notarytool keychain profile
# (see dist/README.md → "One-time credentials"). Works for both the host and the engine.
# Usage: dist/notarize.sh <App.app> [keychain-profile]
set -euo pipefail
APP="${1:?usage: dist/notarize.sh <App.app> [keychain-profile]}"
PROFILE="${2:-meetamask-notary}"
ZIP="${APP%.app}.notarize.zip"

echo "▸ Zipping for submission…"
rm -f "$ZIP"; ditto -c -k --keepParent "$APP" "$ZIP"

echo "▸ Submitting to Apple notary service (a few minutes)…"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait

echo "▸ Stapling the ticket into the .app (so it passes Gatekeeper OFFLINE)…"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
rm -f "$ZIP"

echo "✅ notarized + stapled: $APP"
spctl -a -vvv "$APP" 2>&1 | head -2 || true   # expect: accepted, source=Notarized Developer ID
