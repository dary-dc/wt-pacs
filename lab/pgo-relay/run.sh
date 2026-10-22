#!/usr/bin/env bash
# The two cells of README.md, three arms each, 24 rounds: rows to $OUT/<rate>.tsv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/lab/pgo-relay/rows}"
mkdir -p "$OUT"
plain=$ROOT/target/release/series-server pgo=$ROOT/target/pgo/release/series-server
for kbit in ${RATES:-103000 18000}; do
  SERVER_CPUS=0,1 RELAY_CPUS=2 CLIENT_CPUS=3 RELAY="--delay-ms 23 --rate-kbit $kbit --queue-ms 20" \
    "$ROOT/lab/scripts/runtime_ab.sh" "$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd" fill 1 80 1 "${ROUNDS:-24}" \
    plain "$plain" -- plain2 "$plain" -- pgo "$pgo" | tee "$OUT/$kbit.tsv"
done
