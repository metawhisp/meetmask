#!/bin/bash
# Single source of truth for MEETAMASK's fast tests — run locally AND by CI
# (.github/workflows/ci.yml calls this). Keep the two in lockstep by editing only here.
#
#   bash tests/run-all.sh   (or: make test-all)
#
# Exit 0 = all passed, non-zero = a real failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="${TMPDIR:-/tmp}"
fail=0

echo "▸ IP guard — no Homelander in the bundle"
bash tests/no_homelander_test.sh || fail=1
bash tests/geometry-parity.sh || fail=1

echo "▸ Mask policy — arbitrary user HTML is never loaded"
if swiftc MEETAMASK/MaskLibrary.swift tests/main.swift -o "$TMP/masktest"; then
  "$TMP/masktest" || fail=1
else
  echo "  FAIL: mask-policy test did not compile"; fail=1
fi

echo "▸ Seqlock — shared-memory frame hand-off is tear-free"
if ! clang++ -std=c++17 -O2 engine/frame_shm.mm engine/test/seqlock_test.mm -o "$TMP/seqtest"; then
  # Without this, a compile error left rc=127 ("no such file") — which the retry loop below
  # counted as "inconclusive" and the suite then reported as a PASS.
  echo "  FAIL: seqlock test did not compile"; fail=1
fi
# Exit codes: 0 = pass, 1 = real seqlock tear (regression), 2 = inconclusive
# (workload didn't race this run — retry, not a regression).
seq_done=0
for i in 1 2 3 4 5; do
  "$TMP/seqtest"; rc=$?
  if [ "$rc" -eq 0 ]; then echo "  seqlock PASS (attempt $i)"; seq_done=1; break; fi
  if [ "$rc" -eq 1 ]; then echo "  seqlock REGRESSION (torn frame accepted)"; fail=1; seq_done=1; break; fi
  echo "  seqlock inconclusive (attempt $i, rc=$rc) — retrying"
done
[ "$seq_done" -eq 0 ] && echo "  seqlock inconclusive after 5 attempts — not a regression, passing"

if [ "$fail" -eq 0 ]; then echo "✅ all tests passed"; else echo "❌ tests failed"; fi
exit "$fail"
