#!/usr/bin/env bash
# The viewer's page check in headless Chromium on a series the gate can make, filled and on demand, each with a cine, on
# each client: the contract's 16-bit grey codestream 50 times, with its digest, as OT and as DX.
# The cross-codec arm and Firefox need the DICOM ingest's bundles: client/README.md §The viewer.
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
n=50
digests="$(for _ in $(seq "$n"); do printf '"%s", ' "$d"; done)"
mkdir "$T/frames"
for i in $(seq 0 $((n - 1))); do cp client/contract/frames/grey-16.j2c "$T/frames/$(printf %03d "$i").htj2k"; done
# OT steps at 30 a second, slower than the page's frames and faster than a held paint; DX at 60, faster than a held ask.
for series in "OT 33.33" "DX 16.67"; do
  read -r modality ms <<<"$series"
  cat >"$T/$modality.json" <<JSON
{"frameCount": $n, "frameTimeMs": $ms, "codec": "htj2k", "photometric": "MONOCHROME2", "modality": "$modality",
 "window": {"center": [30000], "width": [60000], "function": "LINEAR"},
 "digests": {"algorithm": "xxh3-64", "frames": [${digests%, }]}}
JSON
  "${CARGO_TARGET_DIR:-target}/release/pack-series" --metadata "$T/$modality.json" --frames "$T/frames" --output "$T/$modality.sbnd" >/dev/null
done
for client in ts wasm; do
  node client/viewer/check.mjs --series "$T/OT.sbnd" --decoder htj2k --client $client --cine
  node client/viewer/check.mjs --series "$T/DX.sbnd" --decoder htj2k --client $client --fill 0 --cine
done
echo "SKIPPED: the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer)"
