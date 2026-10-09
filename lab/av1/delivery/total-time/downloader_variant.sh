#!/usr/bin/env bash
# Adds variant NAME to every set under FRAMES: the HTJ2K frames through client/downloader/ as it was at
# REV — the downloader and its decoder modules — beside the tree's own in variant `htj2k`: the
# before/after of a client change (the downloader and seam reworks).
#   lab/av1/delivery/total-time/downloader_variant.sh REV NAME [FRAMES]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REV=$1 NAME=$2 FRAMES="${3:-$ROOT/lab/.av1-work/total}"
DIR="$FRAMES/client-$NAME"
rm -rf "$DIR" && mkdir -p "$DIR"
git -C "$ROOT" archive "$REV" client/downloader | tar -x -C "$DIR" --strip-components=2
for variants in "$FRAMES"/*/variants.json; do
  python3 - "$variants" "/${DIR#"$ROOT/"}" "$NAME" <<'PY'
import json, sys
p, url, name = sys.argv[1:]
s = json.load(open(p))
s["variants"][name] = {"downloader": f"{url}/downloader.js", "decoder": f"{url}/decoder.js"}
json.dump(s, open(p, "w"), indent=1)
PY
done
