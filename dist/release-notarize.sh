#!/bin/bash
# Notarize + staple BOTH artifacts, then re-zip the stapled engine for distribution.
# Not `set -e` at top level so one failure doesn't abort the other.
set -uo pipefail
PROFILE="${1:-meetamask}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/build/dist/MEETAMASKEngine.app"
# The DISTRIBUTABLE host is the exportArchive product. `build/app/...` is the plain
# `xcodebuild build` output: Developer ID signature over a Development profile, which
# macOS SIGKILLs at launch (see dist/README.md). Notarizing that ships a dead app.
HOST="${HOST_APP:-$ROOT/build/export/MEETAMASK.app}"

echo "================ NOTARIZE ENGINE (~305MB, biggest) ================"
bash "$ROOT/dist/notarize.sh" "$ENGINE" "$PROFILE" ; ENGINE_RC=$?

echo "================ NOTARIZE HOST (~1.5MB) ================"
bash "$ROOT/dist/notarize.sh" "$HOST" "$PROFILE" ; HOST_RC=$?

echo "================ RE-ZIP STAPLED ENGINE → final download ================"
if [ "$ENGINE_RC" -eq 0 ]; then
  rm -f "$ROOT/build/dist/MEETAMASKEngine.zip"
  ditto -c -k --keepParent "$ENGINE" "$ROOT/build/dist/MEETAMASKEngine.zip"
  echo "engine zip: $(du -sh "$ROOT/build/dist/MEETAMASKEngine.zip" | cut -f1)"
fi

echo "================ FINAL VERIFY ================"
echo "engine notarize rc=$ENGINE_RC  host notarize rc=$HOST_RC"
echo "engine spctl: $(spctl -a -vvv -t exec "$ENGINE" 2>&1 | tail -1)"
echo "host   spctl: $(spctl -a -vvv -t exec "$HOST" 2>&1 | tail -1)"
echo "================ DONE ================"
