#!/usr/bin/env bash
# Adds arm NAME to every set under FRAMES: the HTJ2K frames through client/downloader/downloader.js as
# it was at REV, beside the tree's own in arm `htj2k` — the before/after of a downloader change (row CLIENT).
#   lab/av1/total/downloader_arm.sh REV NAME [FRAMES]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
REV=$1 NAME=$2 FRAMES="${3:-$ROOT/lab/.av1-work/total}"
git -C "$ROOT" show "$REV:client/downloader/downloader.js" > "$FRAMES/downloader-$NAME.js"
for arms in "$FRAMES"/*/arms.json; do
  python3 - "$arms" "/${FRAMES#"$ROOT/"}/downloader-$NAME.js" "$NAME" <<'PY'
import json, sys
p, url, name = sys.argv[1:]
s = json.load(open(p))
s["arms"][name] = {"downloader": url}
json.dump(s, open(p, "w"), indent=1)
PY
done
