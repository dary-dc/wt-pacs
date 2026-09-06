#!/usr/bin/env bash
# Telemetry pipeline microbench matrix — emit seams under contention, drain shapes at scale.
# No network, no product crate. Output: one JSON object per line.
#
# Usage: lab/scripts/telemetry_bench_matrix.sh [out.jsonl]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/.local/measurements/telemetry-bench-$(date -u +%Y%m%dT%H%M%SZ).jsonl}"
SCRATCH="${SCRATCH:-$ROOT/.local/telemetry-bench-scratch}"
mkdir -p "$(dirname "$OUT")" "$SCRATCH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

cargo build --release -p telemetry-bench >/dev/null
BIN="$CARGO_TARGET_DIR/release/telemetry-bench"

: > "$OUT"
run() { "$BIN" "$@" | tee -a "$OUT"; }

echo "# emit: busy producers, count sink (producer cost + drop rate under max pressure)"
TOTAL=${TOTAL_EMITS:-4000000}
for p in 1 4 16 64; do
  per=$(( TOTAL / p ))
  for seam in global-lock own-sender own-batch; do
    run emit --seam "$seam" --sink count --producers "$p" --emits-per-producer "$per"
  done
done

echo "# emit: paced producers (16 sessions), drain must keep up: json vs binary sink"
# 16 × 1875/s ≈ 30k rows/s (1000 viewers @ 30 fps); 16 × 9375/s ≈ 150k rows/s (5000 viewers).
for rate in 1875 9375; do
  per=$(( rate * 5 ))
  for seam in global-lock own-batch; do
    for sink in count json-file binary-file; do
      run emit --seam "$seam" --sink "$sink" --producers 16 --rate-per-producer "$rate" \
        --emits-per-producer "$per" --scratch "$SCRATCH"
    done
  done
done

echo "# report: drain memory and shutdown time as rows grow"
for rows in 1000000 10000000; do
  run report --shape current --rows "$rows" --out-dir "$SCRATCH"
  run report --shape streaming --rows "$rows" --out-dir "$SCRATCH" --offline-exact
done
run report --shape streaming --rows 100000000 --out-dir "$SCRATCH" --offline-exact

echo "wrote $OUT"
