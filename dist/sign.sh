#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MEETAMASK — Developer ID inside-out signing (for distribution / notarization).
#
# Re-signs the whole app with a Developer ID Application cert + hardened runtime,
# INSIDE-OUT (deepest nested code first), which is the only order Gatekeeper /
# notarization accept. The bundled CEF engine (framework + 5 helper apps + engine
# binary) is the tricky part — each gets the CEF entitlements (JIT etc.).
#
# Usage:  dist/sign.sh <App.app> ["Developer ID Application: NAME (TEAMID)"]
# Default identity: the one found on this machine for team 6D6948Z4MW.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
APP="${1:?usage: dist/sign.sh <App.app> [identity]}"
ID="${2:-Developer ID Application: Andrey Dyuzhov (6D6948Z4MW)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CEF_ENT="$HERE/entitlements/cef.plist"
SIGN=(codesign --force --timestamp --options runtime --sign "$ID")

ENGINE="$APP/Contents/Resources/MEETAMASKEngine.app"
FW="$ENGINE/Contents/Frameworks/Chromium Embedded Framework.framework"

echo "▸ Extracting host + extension entitlements from the current build…"
TMP="$(mktemp -d)"
codesign -d --entitlements "$TMP/host.plist" --xml "$APP" 2>/dev/null || : > "$TMP/host.plist"
EXT="$(ls -d "$APP"/Contents/Library/SystemExtensions/*.systemextension 2>/dev/null | head -1 || true)"
[ -n "${EXT:-}" ] && codesign -d --entitlements "$TMP/ext.plist" --xml "$EXT" 2>/dev/null || true

echo "▸ [1] CEF framework"
"${SIGN[@]}" "$FW"

echo "▸ [2] CEF helper apps (JIT entitlements)"
for h in "$ENGINE/Contents/Frameworks/"*Helper*.app; do
  "${SIGN[@]}" --entitlements "$CEF_ENT" "$h/Contents/MacOS/"*
  "${SIGN[@]}" --entitlements "$CEF_ENT" "$h"
done

echo "▸ [3] Engine browser process"
"${SIGN[@]}" --entitlements "$CEF_ENT" "$ENGINE/Contents/MacOS/MEETAMASKEngine"
"${SIGN[@]}" --entitlements "$CEF_ENT" "$ENGINE"

if [ -n "${EXT:-}" ]; then
  echo "▸ [4] Camera system extension"
  if [ -s "$TMP/ext.plist" ]; then "${SIGN[@]}" --entitlements "$TMP/ext.plist" "$EXT"; else "${SIGN[@]}" "$EXT"; fi
fi

echo "▸ [5] Host app (seals everything)"
if [ -s "$TMP/host.plist" ]; then "${SIGN[@]}" --entitlements "$TMP/host.plist" "$APP"; else "${SIGN[@]}" "$APP"; fi

echo "▸ Verify"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -3
echo "— spctl (will say 'rejected: not notarized' until dist/notarize.sh runs — signature itself is valid) —"
spctl -a -vvv "$APP" 2>&1 | head -3 || true
rm -rf "$TMP"
echo "✅ Developer ID signing done."
