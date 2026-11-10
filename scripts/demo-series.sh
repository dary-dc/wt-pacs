#!/usr/bin/env bash
# Three breast tomosynthesis series, each as its exact HTJ2K series and eighteen optimal-quality ones paired
# with it (Q 8 and 24, G 1, 8 and 16 a series each), and the 12-bit two's depth cut at Q 8, G 1 and 16: every
# bundle's bytes, as a ratio of its exact series'.
# docs/av1/payload-format.md §Optimal quality.
#
#   scripts/demo-series.sh [OUT]     default OUT demo-series; BUILD=... as ingest/tools.sh, default ingest/.build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "${1:-demo-series}" && cd "${1:-demo-series}" && pwd)"
BUILD="${BUILD:-$ROOT/ingest/.build}"
DATA="${DATA:-$ROOT/lab/av1/data}"
SETS=(dbts_a1 dbts_b1 dbts_c1)
QS=(8 24)
GS=(1 8 16)
CUT_SETS=(dbts_a1 dbts_c1)
CUT_GS=(1 16)
start=$SECONDS

[[ -x "$BUILD/aom-3.15.1/bin/aomenc" && -f "$BUILD/payload/libdecode.so" ]] || BUILD="$BUILD" "$ROOT/ingest/tools.sh"
OUT="$DATA" "$ROOT/lab/av1/fetch_data.sh" "${SETS[@]}"
cargo build --release --quiet -p pack-series --manifest-path "$ROOT/Cargo.toml"
PY="${VENV:-$ROOT/lab/av1/.venv}/bin/python"

ingest() {  # SET ID [ingest_coded.py's options]
  local set=$1 id=$2 t=$SECONDS
  shift 2
  rm -rf "$OUT/$id"
  "$PY" "$ROOT/lab/av1/tools/ingest_coded.py" "$BUILD" "$DATA/$set" "$OUT/$id" --jobs "$(nproc)" "$@" >/dev/null
  "$ROOT/target/release/pack-series" --metadata "$OUT/$id/metadata.json" --frames "$OUT/$id" --output "$OUT/$id.sbnd" >/dev/null
  rm -rf "${OUT:?}/$id"
  echo "$id $((SECONDS - t))" >>"$OUT/seconds"
}

rm -f "$OUT/seconds"
for set in "${SETS[@]}"; do
  ingest "$set" "$set" --codec htj2k
  for q in "${QS[@]}"; do
    for g in "${GS[@]}"; do
      ingest "$set" "$set-q$q-g$g" --lossy "$q" "$g" --exact-series "$set"
    done
  done
done
for set in "${CUT_SETS[@]}"; do
  for g in "${CUT_GS[@]}"; do
    ingest "$set" "$set-q8-g$g-cut" --lossy 8 "$g" --exact-series "$set" --depth-cut
  done
done

printf '%-18s %14s %9s %6s\n' series bytes "of exact" s
for set in "${SETS[@]}"; do
  exact=$(stat -c %s "$OUT/$set.sbnd")
  cuts=$([[ " ${CUT_SETS[*]} " == *" $set "* ]] && for g in "${CUT_GS[@]}"; do echo "$set-q8-g$g-cut"; done)
  for id in "$set" $(for q in "${QS[@]}"; do for g in "${GS[@]}"; do echo "$set-q$q-g$g"; done; done) $cuts; do
    bytes=$(stat -c %s "$OUT/$id.sbnd")
    awk -v id="$id" -v b="$bytes" -v e="$exact" -v s="$(awk -v id="$id" '$1 == id {print $2}' "$OUT/seconds")" \
      'BEGIN { printf "%-18s %14d %9.4f %6d\n", id, b, b / e, s }'
  done
done
echo "$((SECONDS - start)) s in all on $(nproc) cores, $(uname -m), $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //')"
