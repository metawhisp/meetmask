#!/bin/bash
# Guard test: the "Homelander" effect (The Boys IP) must NOT ship in the bundle.
# It was excluded pending a rights review — this fails the build surface if the
# code, an import, or a mask for it ever reappears under what gets bundled.
#
# Run:  bash tests/no_homelander_test.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

# 1. No homelander source file under the bundled prototype.
if ls "$ROOT"/Prototype/effects/registry/homelander.js >/dev/null 2>&1; then
  echo "FAIL: Prototype/effects/registry/homelander.js exists"; fail=1
fi

# 2. No reference to 'homelander' anywhere in the bundled prototype (imports, registry, comments).
hits=$(grep -rniE "homelander" "$ROOT/Prototype" 2>/dev/null)
if [ -n "$hits" ]; then
  echo "FAIL: 'homelander' referenced in bundled Prototype:"; echo "$hits"; fail=1
fi

# 3. No homelander mask in the bundled gallery.
if [ -d "$ROOT/Masks/homelander" ]; then
  echo "FAIL: Masks/homelander/ exists"; fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: no Homelander in bundle (no file, no import, no mask)."
fi
exit "$fail"
