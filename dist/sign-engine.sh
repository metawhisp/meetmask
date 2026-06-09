#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Sign a STANDALONE MEETAMASKEngine.app (the downloadable artifact) with Developer ID
# + hardened runtime, INSIDE-OUT, so it passes `codesign --deep --strict` and notarizes.
#
# The CEF framework is the fiddly part: it ships dylibs in Versions/A/Libraries and a
# bogus self-referential symlink (Versions/A/A -> A, an artifact of CMake copy_directory)
# that breaks `codesign --strict`. We strip such symlinks, then sign deepest-first.
#
# Usage: dist/sign-engine.sh <MEETAMASKEngine.app> ["Developer ID Application: NAME (TEAM)"]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
APP="${1:?usage: dist/sign-engine.sh <MEETAMASKEngine.app> [identity]}"
ID="${2:-Developer ID Application: Andrey Dyuzhov (6D6948Z4MW)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CEF_ENT="$HERE/entitlements/cef.plist"
SIGN=(codesign --force --timestamp --options runtime --sign "$ID")
FW="$APP/Contents/Frameworks/Chromium Embedded Framework.framework"

echo "▸ [0] Strip bogus self-referential symlinks (e.g. Versions/A/A -> A) that break --strict"
find "$APP" -type l | while read -r link; do
  if [ "$(readlink "$link")" = "$(basename "$link")" ]; then echo "    rm $link"; rm -f "$link"; fi
done

echo "▸ [1] Framework dylibs (libEGL/libGLESv2/libvk_swiftshader/libcef_sandbox)"
# Locate by content, not a hardcoded path — CEF lays them out under Libraries/ (a real dir
# or a symlink to Versions/A/Libraries depending on the dist). -type f signs the real files.
find "$FW" -type f -name "*.dylib" -print0 | while IFS= read -r -d '' d; do "${SIGN[@]}" "$d"; done

echo "▸ [2] CEF framework"
"${SIGN[@]}" "$FW"

echo "▸ [3] Helper apps (JIT entitlements, inside-out)"
for h in "$APP/Contents/Frameworks/"*Helper*.app; do
  "${SIGN[@]}" --entitlements "$CEF_ENT" "$h/Contents/MacOS/"*
  "${SIGN[@]}" --entitlements "$CEF_ENT" "$h"
done

echo "▸ [4] Engine browser process"
"${SIGN[@]}" --entitlements "$CEF_ENT" "$APP/Contents/MacOS/MEETAMASKEngine"
"${SIGN[@]}" --entitlements "$CEF_ENT" "$APP"

echo "▸ Verify (notarization level)"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
echo "✅ engine signed; codesign --deep --strict passed"
