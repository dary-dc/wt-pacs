#!/usr/bin/env bash
# The kit's bundles, on the local machine: each set as SET.htj2k.sbnd and SET.av1.sbnd (ingest's optimized
# representation, the product's), every frame decoded back against the source before it is packed.
#
#   OUT=DIR lab/devices/make_bundles.sh [set ...]     default: D1's sets, D2's among them
#
# Needs what ingest/coded-frames/README.md builds: lab/.av1-build, OpenJPH, the check's decoders, the venv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:?set OUT to the bundles directory, STUDIES for deploy.sh}"
P="${PYTHON:-$ROOT/lab/av1/.venv/bin/python}"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
PRESET="${PRESET:-cpu0}"
sets=("$@")
[[ ${#sets[@]} -gt 0 ]] || sets=(dbt10_ea1141 mr_ispy1 rf_fluoro)
"$ROOT/lab/av1/fetch_data.sh" "${sets[@]}"
cargo build -q --release -p pack-series --manifest-path "$ROOT/Cargo.toml"
mkdir -p "$OUT"
for s in "${sets[@]}"; do
  for codec in htj2k av1; do
    work="$OUT/.work/$s.$codec"
    rm -rf "$work"
    "$P" "$ROOT/ingest/coded-frames/ingest.py" "$BUILD" "$ROOT/lab/av1/data/$s" "$work" --codec "$codec" \
      --preset "$PRESET" --jobs "$(nproc)"
    "${CARGO_TARGET_DIR:-$ROOT/target}/release/pack-series" --metadata "$work/metadata.json" --frames "$work" \
      --output "$OUT/$s.$codec.sbnd"
    echo "$s.$codec.sbnd: $(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["frameCount"], "frames,", m["digests"]["algorithm"])' "$work/metadata.json")"
  done
done
rm -rf "$OUT/.work"
