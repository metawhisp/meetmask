#!/bin/bash
# ⚠️ NOT FOR DISTRIBUTION. This script re-signs an existing bundle but does NOT replace its
# embedded provisioning profile. On a product of `xcodebuild build` that leaves a Development
# profile under a Developer ID signature — the host then fails AMFI's launch check and macOS
# SIGKILLs it (exit 163) on every user's Mac, while codesign and spctl still report success.
# That combination shipped as the dead v0.2. To release, ARCHIVE + `-exportArchive` with
# dist/exportOptions-devid.plist (see dist/README.md). Keep this script only for local
# experiments on a bundle whose profile is already correct.
#
# Sign the LIGHT host app (no engine — just Swift UI + camera system-extension) with
# Developer ID + hardened runtime, inside-out, preserving its build-time entitlements.
# Usage: dist/sign-host.sh <MEETAMASK.app> ["Developer ID Application: NAME (TEAM)"]
set -euo pipefail
echo "⚠️  sign-host.sh is NOT the release path — releases use archive + exportArchive (dist/README.md)." >&2
APP="${1:?usage: dist/sign-host.sh <MEETAMASK.app> [identity]}"
ID="${2:-Developer ID Application: Andrey Dyuzhov (6D6948Z4MW)}"
SIGN=(codesign --force --timestamp --options runtime --sign "$ID")
TMP="$(mktemp -d)"

# Xcode dev builds inject `com.apple.security.get-task-allow` (debugger attach). Notarization
# REJECTS it — strip it from the entitlements we carry over to the Developer ID signature.
strip_debug() { /usr/libexec/PlistBuddy -c "Delete :com.apple.security.get-task-allow" "$1" 2>/dev/null || true; }

EXT="$(ls -d "$APP"/Contents/Library/SystemExtensions/*.systemextension 2>/dev/null | head -1 || true)"
if [ -n "${EXT:-}" ]; then
  echo "▸ Camera system extension"
  codesign -d --entitlements "$TMP/ext.plist" --xml "$EXT" 2>/dev/null || : > "$TMP/ext.plist"
  strip_debug "$TMP/ext.plist"
  if [ -s "$TMP/ext.plist" ]; then "${SIGN[@]}" --entitlements "$TMP/ext.plist" "$EXT"; else "${SIGN[@]}" "$EXT"; fi
fi

echo "▸ Host app"
codesign -d --entitlements "$TMP/host.plist" --xml "$APP" 2>/dev/null || : > "$TMP/host.plist"
strip_debug "$TMP/host.plist"
if [ -s "$TMP/host.plist" ]; then "${SIGN[@]}" --entitlements "$TMP/host.plist" "$APP"; else "${SIGN[@]}" "$APP"; fi

echo "▸ Verify"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
rm -rf "$TMP"
echo "✅ host signed; codesign --deep --strict passed"
