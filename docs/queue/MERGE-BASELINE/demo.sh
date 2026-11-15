#!/usr/bin/env bash
# demo.sh: demo-series.sh's two dbts_a1 bundles, then demo-check.mjs in both views, on unified-client
set -uo pipefail
W=/home/user/tips/unified-client; S=/home/user/scratch-base; OUT=/home/user/demo-series; DATA=/home/user/demo-data
cd $W; export CARGO_TARGET_DIR=/home/user/target-unified-client NODE_PATH=/opt/node22/lib/node_modules
mkdir -p $OUT; cargo build --release --quiet -p pack-series
PY=$W/lab/av1/.venv/bin/python; BUILD=$W/ingest/.build
ingest() { local set=$1 id=$2 t=$SECONDS; shift 2; rm -rf "$OUT/$id"
  "$PY" lab/av1/tools/ingest_coded.py "$BUILD" "$DATA/$set" "$OUT/$id" --jobs "$(nproc)" "$@" >/dev/null || return 1
  $CARGO_TARGET_DIR/release/pack-series --metadata "$OUT/$id/metadata.json" --frames "$OUT/$id" --output "$OUT/$id.sbnd" >/dev/null || return 1
  mv "$OUT/$id/metadata.json" "$OUT/$id.metadata.json"; rm -rf "$OUT/$id"; echo "$id $((SECONDS - t)) s $(stat -c %s $OUT/$id.sbnd) bytes"; }
{ ingest dbts_a1 dbts_a1 --codec htj2k; ingest dbts_a1 dbts_a1-q8-g8-cut --lossy 8 8 --exact-series dbts_a1 --depth-cut; } > $S/demo-ingest.log 2>&1
echo "ingest $?" >> $S/demo-ingest.log
for v in page worker; do node client/viewer/demo-check.mjs $OUT dbts_a1-q8-g8-cut --view $v > $S/demo-$v.log 2>&1; echo "demo-$v $?" >> $S/demo-ingest.log; done
