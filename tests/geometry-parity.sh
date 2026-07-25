#!/bin/bash
# The virtual-camera frame geometry is compiled INDEPENDENTLY into three places:
#   Shared/Shared.swift        — host app + camera system extension (the CMIO format)
#   engine/frame_geometry.h    — the CEF engine that writes frames
#   MEETAMASK/EngineInstaller  — engineContract, which forces a stale engine to re-download
# If they drift, the host silently rejects every frame and the camera goes black. This is
# exactly the bug that shipped once; keep it impossible.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "❌ geometry parity: $*"; exit 1; }

sw_w=$(grep -oE 'fixedCamWidth: *Int32 *= *[0-9]+'  Shared/Shared.swift | grep -oE '[0-9]+$')
sw_h=$(grep -oE 'fixedCamHeight: *Int32 *= *[0-9]+' Shared/Shared.swift | grep -oE '[0-9]+$')
en_w=$(grep -oE 'kFrameWidth *= *[0-9]+'  engine/frame_geometry.h | grep -oE '[0-9]+$')
en_h=$(grep -oE 'kFrameHeight *= *[0-9]+' engine/frame_geometry.h | grep -oE '[0-9]+$')

[ -n "$sw_w" ] && [ -n "$sw_h" ] || fail "could not read Shared/Shared.swift"
[ -n "$en_w" ] && [ -n "$en_h" ] || fail "could not read engine/frame_geometry.h"
[ "$sw_w" = "$en_w" ] || fail "width differs — Shared.swift=$sw_w engine=$en_w"
[ "$sw_h" = "$en_h" ] || fail "height differs — Shared.swift=$sw_h engine=$en_h"

# The engine contract string gates re-download of an outdated engine; it must name the
# geometry the host actually expects, otherwise a stale engine is accepted and drops frames.
contract=$(grep -oE 'engineContract *= *"[^"]+"' MEETAMASK/EngineInstaller.swift | sed 's/.*"\(.*\)"/\1/')
[ -n "$contract" ] || fail "could not read engineContract from MEETAMASK/EngineInstaller.swift"
case "$contract" in
  *"${sw_w}x${sw_h}"*) ;;
  *) fail "engineContract '$contract' does not mention ${sw_w}x${sw_h}" ;;
esac

echo "✅ geometry parity: ${sw_w}x${sw_h} agreed by Shared.swift, frame_geometry.h and engineContract ('$contract')"
