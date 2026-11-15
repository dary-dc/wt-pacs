#!/usr/bin/env bash
# A series the page decodes, from tracked bytes: the contract's 16-bit grey codestream three times, with its digest,
# written as a deployment's studies hold one, DIR/grey.sbnd and DIR/grey.metadata.json.
#   scripts/grey_series.sh DIR
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$1"
F="$(mktemp -d)"
trap 'rm -rf "$F"' EXIT
mkdir -p "$DIR"
for i in 000 001 002; do cp "$ROOT/client/contract/frames/grey-16.j2c" "$F/$i.htj2k"; done
d="$(cat "$ROOT/client/contract/frames/grey-16.xxh3")"
cat >"$DIR/grey.metadata.json" <<JSON
{"frameCount": 3, "codec": "htj2k", "photometric": "MONOCHROME2", "modality": "OT",
 "window": {"center": [30000], "width": [60000], "function": "LINEAR"},
 "digests": {"algorithm": "xxh3-64", "frames": ["$d", "$d", "$d"]}}
JSON
(cd "$ROOT" && cargo build -q --release -p pack-series)
"${CARGO_TARGET_DIR:-$ROOT/target}/release/pack-series" --metadata "$DIR/grey.metadata.json" --frames "$F" \
  --output "$DIR/grey.sbnd" >/dev/null
