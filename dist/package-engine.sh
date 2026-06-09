#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Produce a clean, Developer-ID-signed MEETAMASKEngine.app + zip — the artifact the
# app downloads on first launch. Fixes the CMake-mangled CEF framework (which breaks
# codesign --strict) by replacing it with a pristine ditto copy, then signs inside-out.
#
# Usage: dist/package-engine.sh [engine.app] [pristine-framework] [identity]
# Output: build/dist/MEETAMASKEngine.app (signed) + build/dist/MEETAMASKEngine.zip
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SRC="${1:-engine/build/Release/MEETAMASKEngine.app}"
PRISTINE_FW="${2:-cef/dist/Release/Chromium Embedded Framework.framework}"
ID="${3:-Developer ID Application: Andrey Dyuzhov (6D6948Z4MW)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$ROOT/build/dist"
APP="$OUT/MEETAMASKEngine.app"

mkdir -p "$OUT"
echo "▸ Staging engine ($SRC)…"
rm -rf "$APP"; ditto "$SRC" "$APP"

echo "▸ Replacing CMake-mangled CEF framework with a clean pristine copy…"
FWDST="$APP/Contents/Frameworks/Chromium Embedded Framework.framework"
[ -d "$PRISTINE_FW" ] || { echo "❌ pristine framework not found: $PRISTINE_FW"; exit 1; }
rm -rf "$FWDST"; ditto "$PRISTINE_FW" "$FWDST"

echo "▸ Signing inside-out (Developer ID + hardened runtime)…"
bash "$HERE/sign-engine.sh" "$APP" "$ID"

echo "▸ Zipping distributable…"
rm -f "$OUT/MEETAMASKEngine.zip"
ditto -c -k --keepParent "$APP" "$OUT/MEETAMASKEngine.zip"

echo "✅ engine artifact ready:"
echo "   $APP  ($(du -sh "$APP" | cut -f1))"
echo "   $OUT/MEETAMASKEngine.zip  ($(du -sh "$OUT/MEETAMASKEngine.zip" | cut -f1))"
echo "   → next: dist/notarize.sh \"$APP\"  (needs a notarytool keychain profile)"
