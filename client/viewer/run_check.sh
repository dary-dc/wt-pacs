#!/usr/bin/env bash
# The viewer's page check in headless Chromium on a series the gate can make, filled with a cine and on demand, on each
# client: the contract's 16-bit grey codestream, with its digest, as OT and as DX. The cross-codec arm and
# Firefox need the DICOM ingest's bundles: client/README.md §The viewer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
require_browser
require_vendor
require_transport_wasm
cargo build -q --release -p series-server -p pack-series
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
d="$(cat client/contract/frames/grey-16.xxh3)"
# OT is 50 frames at 60 a second, the cine's; DX is three.
for series in "OT 50 16.67" "DX 3 100"; do
  read -r modality n ms <<<"$series"
  mkdir "$T/$modality"
  for i in $(seq 0 $((n - 1))); do cp client/contract/frames/grey-16.j2c "$T/$modality/$(printf %03d "$i").htj2k"; done
  digests="$(for _ in $(seq "$n"); do printf '"%s", ' "$d"; done)"
  cat >"$T/$modality.json" <<JSON
{"frameCount": $n, "frameTimeMs": $ms, "codec": "htj2k", "photometric": "MONOCHROME2", "modality": "$modality",
 "window": {"center": [30000], "width": [60000], "function": "LINEAR"},
 "digests": {"algorithm": "xxh3-64", "frames": [${digests%, }]}}
JSON
  "${CARGO_TARGET_DIR:-target}/release/pack-series" --metadata "$T/$modality.json" --frames "$T/$modality" --output "$T/$modality.sbnd" >/dev/null
done
for client in ts wasm; do
  node client/viewer/check.mjs --series "$T/OT.sbnd" --decoder htj2k --client $client --cine
  node client/viewer/check.mjs --series "$T/DX.sbnd" --decoder htj2k --client $client --fill 0
done
echo "SKIPPED: the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer)"
