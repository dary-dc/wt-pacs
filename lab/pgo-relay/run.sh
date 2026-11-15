#!/usr/bin/env bash
# The two cells of README.md, three arms each, 24 rounds: rows to $OUT/<rate>.tsv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/lab/pgo-relay/rows}"
mkdir -p "$OUT"
plain=$ROOT/target/release/series-server pgo=$ROOT/target/pgo/release/series-server
# Per-core busy fraction, one line a second: cpu0..cpu3 from /proc/stat.
sample() {
  local prev now
  prev=$(grep '^cpu[0-3] ' /proc/stat)
  while sleep 1; do
    now=$(grep '^cpu[0-3] ' /proc/stat)
    paste <(echo "$prev") <(echo "$now") | awk '{t0=0; for(i=2;i<=11;i++) t0+=$i; t1=0; for(i=13;i<=22;i++) t1+=$i;
      idle=($(16)+$(17))-($5+$6); printf "%.3f%s", 1-idle/(t1-t0), (NR==4?"\n":"\t")}'
    prev=$now
  done
}
for kbit in ${RATES:-103000 18000}; do
  sample >"$OUT/$kbit.cores" & sampler=$!
  SERVER_CPUS=0,1 RELAY_CPUS=2 CLIENT_CPUS=3 RELAY="--delay-ms 23 --rate-kbit $kbit --queue-ms 20" \
    "$ROOT/lab/scripts/runtime_ab.sh" "$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd" fill 1 80 1 "${ROUNDS:-24}" \
    plain "$plain" -- plain2 "$plain" -- pgo "$pgo" | tee "$OUT/$kbit.tsv"
  kill "$sampler"
done
