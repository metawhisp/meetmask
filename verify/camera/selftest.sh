#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MEETAMASK camera self-test — guards the #1 "black screen" regression.
#
# WHAT IT PROVES: the installed app, launched the REAL way (LaunchServices), makes
# the offscreen CEF engine deliver LIVE REAL-camera frames (not a black screen).
#
# WHY IT EXISTS: the engine only receives camera frames when the HOST app is the
# macOS TCC "responsible process" — i.e. launched via Finder / Dock / `open`, NOT
# from a terminal. A terminal launch attributes the camera to the terminal (which
# has no camera grant) → macOS silently delivers no frames → black masks. This test
# always launches the right way and asserts real (non-black) pixels are flowing.
#
# RUN:   bash verify/camera/selftest.sh
# EXIT:  0 = PASS (camera live), non-zero = FAIL (with the reason).
# ─────────────────────────────────────────────────────────────────────────────
set -u
APP="${1:-/Applications/MEETAMASK.app}"
WARMUP="${2:-12}"

echo "[1/4] Quitting any running instance (clean TCC + CEF singleton)…"
pkill -x MEETAMASK 2>/dev/null; pkill -f MEETAMASKEngine 2>/dev/null; sleep 2

echo "[2/4] Launching via LaunchServices — the correct TCC context: open -a $APP"
open -a "$APP" || { echo "❌ FAIL: cannot launch $APP"; exit 1; }
sleep "$WARMUP"

echo "[3/4] Locating the engine's shared-memory frame buffer…"
SHM=$(ps -Ao args 2>/dev/null | grep -oE "\-\-shm=/[^ ]+meetamask-frame[^ ]+" | head -1 | sed 's/--shm=//')
if [ -z "$SHM" ] || [ ! -f "$SHM" ]; then
  echo "❌ FAIL: engine subprocess not found / no shm."
  echo "        → app didn't launch, or camera permission is OFF (no engine start)."
  exit 1
fi
echo "        shm = $SHM"

echo "[4/4] Asserting frames are REAL camera (not black)…"
EXPECT_W=$(grep -oE 'kFrameWidth *= *[0-9]+'  "$(dirname "$0")/../../engine/frame_geometry.h" | grep -oE '[0-9]+$')
EXPECT_H=$(grep -oE 'kFrameHeight *= *[0-9]+' "$(dirname "$0")/../../engine/frame_geometry.h" | grep -oE '[0-9]+$')
python3 - "$SHM" "$EXPECT_W" "$EXPECT_H" <<'PY'
import sys, struct
# No Pillow: stock macOS python3 doesn't have it, and this test must run on a clean Mac.
# Raw BGRA is trivial to sample directly.
buf = open(sys.argv[1], "rb").read()
want_w, want_h = int(sys.argv[2]), int(sys.argv[3])
seq, w, h = struct.unpack_from("<QII", buf, 0)
if seq == 0:
    print("❌ FAIL: engine wrote no frames (it crashed or never started)."); sys.exit(1)
# The geometry the engine actually published must be the geometry this build expects —
# a stale engine publishing 1280x720 is exactly the regression that made the camera black,
# and it produces perfectly non-black pixels, so a luma check alone would pass it.
if (w, h) != (want_w, want_h):
    print(f"❌ FAIL: engine publishes {w}x{h}, this build expects {want_w}x{want_h} — stale engine."); sys.exit(1)
need = 16 + w * h * 4
if len(buf) < need:
    print(f"❌ FAIL: buffer is {len(buf)} bytes, need {need} for {w}x{h}."); sys.exit(1)
# Sample a 48x27 grid straight out of the BGRA plane.
total, n = 0, 0
for gy in range(27):
    y = gy * h // 27
    row = 16 + y * w * 4
    for gx in range(48):
        off = row + (gx * w // 48) * 4
        total += buf[off] + buf[off + 1] + buf[off + 2]   # B,G,R
        n += 3
mean = total / n
print(f"        seq={seq}  frame={w}x{h}  meanLuma={mean:.1f}")
if mean < 10:
    print("❌ FAIL: frames are BLACK — camera not delivering.")
    print("        Fix: System Settings ▸ Privacy & Security ▸ Camera ▸ enable MEETAMASK,")
    print("        and ALWAYS launch via Finder/Dock/`open` — never from a terminal.")
    sys.exit(1)
print("✅ PASS: live real-camera frames are flowing through the engine.")
PY
