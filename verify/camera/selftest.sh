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
python3 - "$SHM" <<'PY'
import sys, struct, statistics
from PIL import Image
buf = open(sys.argv[1], "rb").read()
seq, w, h = struct.unpack_from("<QII", buf, 0)
img = Image.frombytes("RGBA", (1280, 720), buf[16:16 + 1280*720*4]).convert("RGB")
mean = statistics.mean(sum(p)/3 for p in img.resize((48, 27)).getdata())
print(f"        seq={seq}  meanLuma={mean:.1f}")
if seq == 0:
    print("❌ FAIL: engine wrote no frames (it crashed or never started)."); sys.exit(1)
if mean < 10:
    print("❌ FAIL: frames are BLACK — camera not delivering.")
    print("        Fix: System Settings ▸ Privacy & Security ▸ Camera ▸ enable MEETAMASK,")
    print("        and ALWAYS launch via Finder/Dock/`open` — never from a terminal.")
    sys.exit(1)
print("✅ PASS: live real-camera frames are flowing through the engine.")
PY
