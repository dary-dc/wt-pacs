#!/usr/bin/env bash
# The viewer's page check in headless Chromium on a series the gate can make, filled with a cine and on demand, on each
# client, the frames on the page and in the view worker: the contract's 16-bit grey codestream three times, with its
# digest. The cross-codec arm and Firefox need the DICOM ingest's bundles: client/README.md §The viewer.
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
mkdir "$T/frames"
for i in 000 001 002; do cp client/contract/frames/grey-16.j2c "$T/frames/$i.htj2k"; done
d="$(cat client/contract/frames/grey-16.xxh3)"
cat >"$T/metadata.json" <<JSON
{"frameCount": 3, "codec": "htj2k", "photometric": "MONOCHROME2", "modality": "OT",
 "window": {"center": [30000], "width": [60000], "function": "LINEAR"},
 "digests": {"algorithm": "xxh3-64", "frames": ["$d", "$d", "$d"]}}
JSON
"${CARGO_TARGET_DIR:-target}/release/pack-series" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/grey.sbnd" >/dev/null
for view in page worker; do
  for client in ts wasm; do
    node client/viewer/check.mjs --series "$T/grey.sbnd" --decoder htj2k --client $client --view $view --cine
    node client/viewer/check.mjs --series "$T/grey.sbnd" --decoder htj2k --client $client --view $view --fill 0
  done
done
echo "SKIPPED: the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer)"
