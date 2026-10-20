#!/usr/bin/env bash
# The viewer's page check in headless Chromium on a series the gate can make, filled with a cine and on demand, on each
# client: scripts/grey_series.sh's. The cross-codec arm and Firefox need the DICOM ingest's bundles: client/README.md §The viewer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
require_browser
require_vendor
require_transport_wasm
cargo build -q --release -p series-server
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
scripts/grey_series.sh "$T"
for client in ts wasm; do
  node client/viewer/check.mjs --series "$T/grey.sbnd" --decoder htj2k --client $client --cine
  node client/viewer/check.mjs --series "$T/grey.sbnd" --decoder htj2k --client $client --fill 0
done
echo "SKIPPED: the viewer's cross-codec arm and Firefox — they need the DICOM ingest's bundles and a GL display (client/README.md §The viewer)"
