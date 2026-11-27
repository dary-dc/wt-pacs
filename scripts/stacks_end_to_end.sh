#!/usr/bin/env bash
# A breast ultrasound clip and a DBT volume end to end: each pinned set through the product's DICOM ingest, the bundle's
# digests its pinned frames', then served and opened in the page and the view worker, every frame exact. docs/FIXTURES.md §Stacks end to end
#
#   [DATA=lab/av1/data] [INGEST_BUILD=ingest/.build] PYTHON=.venv/bin/python scripts/stacks_end_to_end.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
require_browser
require_vendor
DATA="${DATA:-$ROOT/lab/av1/data}"
BUILD="${INGEST_BUILD:-$ROOT/ingest/.build}"
PY="${PYTHON:-python3}"
MANIFEST=lab/av1/data.json
FIXTURE=ingest/from-dicom/stack_fixture.py
cargo build -q --release -p series-server -p pack-series
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

through() {  # SET INPUT
  local set=$1 out="$T/$1.sbnd" n
  "$PY" ingest/from-dicom/from_dicom.py "$BUILD" "$2" "$out" --codec htj2k --jobs "$(nproc)" >/dev/null
  "$PY" "$FIXTURE" same "$DATA/$set" "$MANIFEST" "$set" "$out"
  n=$(jq .frameCount "$T/$set.metadata.json")
  for view in page worker; do
    node client/viewer/check.mjs --series "$out" --decoder htj2k --view "$view" | tee "$T/check"
    grep -q "^series (htj2k), client ts, view $view: $n/$n received, $n exact," "$T/check" \
      || { echo "$set, view $view: not its $n pinned frames received and exact" >&2; exit 1; }
  done
  said+=" $set $n,"
}
said=""

"$PY" "$FIXTURE" dicom "$DATA/usb_cine" "$T/usb_cine.dcm" --size 512 512 --cine-rate 25
through usb_cine "$T/usb_cine.dcm"
"$PY" "$FIXTURE" dicom "$DATA/usb_cine_rgb" "$T/usb_cine_rgb.dcm" --size 512 512 --channels 3 --cine-rate 30
through usb_cine_rgb "$T/usb_cine_rgb.dcm"
through dbts_a1 "$DATA/dicom/$(jq -r '.sets[] | select(.name == "dbts_a1") | .files[0].key' "$MANIFEST")"
echo "stacks end to end, every frame exact in the page and the view worker:${said%,}"
