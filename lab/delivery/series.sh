#!/usr/bin/env bash
# The arms' series as scripts/demo-series.sh codes them (each set's exact HTJ2K series and its Q 8 G 8 view, the depth
# cut on dbts_a1 and dbts_c1), frames kept beside each bundle for K1, then each form's prefixes of both.
# docs/client/evidence/delivery-comparison.md §2–§4; lab/delivery/README.md
#
#   lab/delivery/series.sh OUT [SET …]        default the three timed sets; BUILD=..., DATA=... as demo-series.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
shift
SETS=("${@:-dbts_a1 dbts_b1 dbts_c1}")
read -ra SETS <<<"${SETS[*]}"
BUILD="${BUILD:-$ROOT/ingest/.build}"
DATA="${DATA:-$ROOT/lab/av1/data}"
PY="${VENV:-$ROOT/lab/av1/.venv}/bin/python"
[[ -x "$BUILD/aom-3.15.1/bin/aomenc" && -f "$BUILD/payload/libdecode.so" ]] || BUILD="$BUILD" "$ROOT/ingest/tools.sh"
OUT="$DATA" "$ROOT/lab/av1/fetch_data.sh" "${SETS[@]}"
cargo build --release --quiet -p pack-series --manifest-path "$ROOT/Cargo.toml"

ingest() {  # SET ID [ingest_coded.py's options]
  local set=$1 id=$2 t=$SECONDS
  shift 2
  [[ -f "$OUT/$id.sbnd" ]] && return
  "$PY" "$ROOT/lab/av1/tools/ingest_coded.py" "$BUILD" "$DATA/$set" "$OUT/$id" --jobs "$(nproc)" "$@" >/dev/null
  "$ROOT/target/release/pack-series" --metadata "$OUT/$id/metadata.json" --frames "$OUT/$id" --output "$OUT/$id.sbnd" >/dev/null
  cp "$OUT/$id/metadata.json" "$OUT/$id.metadata.json"
  echo "$id $((SECONDS - t)) s"
}

for set in "${SETS[@]}"; do
  cut=$([[ $set == dbts_a1 || $set == dbts_c1 ]] && echo --depth-cut || true)
  ingest "$set" "$set" --codec htj2k
  ingest "$set" "$set-q8-g8${cut:+-cut}" --lossy 8 8 --exact-series "$set" $cut
  for n in 8 16; do
    for id in "$set" "$set-q8-g8${cut:+-cut}"; do python3 "$ROOT/lab/delivery/prefix.py" "$OUT" "$id" "$n" >/dev/null; done
  done
  python3 "$ROOT/lab/delivery/prefix.py" "$OUT" "$set" 4 >/dev/null
done
ls -l "$OUT"/*.sbnd
