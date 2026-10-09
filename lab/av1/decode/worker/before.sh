#!/usr/bin/env bash
# client/downloader as it was at COMMIT, into lab/.av1-work/decode/before/, where every arm named *-before loads it.
#
#   lab/av1/decode/worker/before.sh COMMIT
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$ROOT/lab/.av1-work/decode/before"
rm -rf "$OUT"
mkdir -p "$OUT"
git -C "$ROOT" archive "$1" client/downloader | tar -x --strip-components=2 -C "$OUT"
echo "client/downloader at $(git -C "$ROOT" rev-parse --short "$1") in $OUT"
