#!/usr/bin/env bash
# Adds arm NAME to every set under FRAMES: the HTJ2K frames through client/downloader/ as it was at
# REV — the downloader and its decoder modules — beside the tree's own in arm `htj2k`: the
# before/after of a client change (rows CLIENT, SEAM).
#   lab/av1/delivery/total-time/downloader_arm.sh REV NAME [FRAMES]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REV=$1 NAME=$2 FRAMES="${3:-$ROOT/lab/.av1-work/total}"
DIR="$FRAMES/client-$NAME"
rm -rf "$DIR" && mkdir -p "$DIR"
git -C "$ROOT" archive "$REV" client/downloader | tar -x -C "$DIR" --strip-components=2
for arms in "$FRAMES"/*/arms.json; do
  python3 - "$arms" "/${DIR#"$ROOT/"}" "$NAME" <<'PY'
import json, sys
p, url, name = sys.argv[1:]
s = json.load(open(p))
s["arms"][name] = {"downloader": f"{url}/downloader.js", "decoder": f"{url}/decoder.js"}
json.dump(s, open(p, "w"), indent=1)
PY
done
