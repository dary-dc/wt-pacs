#!/usr/bin/env bash
# P3's wake arm (docs/lines/proposals.md §P3, amendment 1): a host root beside TIP whose lossless button's `pointerdown`
# ends the exact session's stream, its wake; the rest is TIP's. Page view only: the page holds the controller.
#
#   lab/proposals/p3_arm.sh TIP ROOT
set -euo pipefail
TIP=$1 ROOT=$2
mkdir -p "$ROOT/server"
rm -rf "$ROOT/client" && cp -a "$TIP/client" "$ROOT/client"
cp "$TIP/server/dev-server.py" "$ROOT/server/"
ln -sfn "$TIP/lab" "$ROOT/lab"
ln -sfn "$TIP/fixtures" "$ROOT/fixtures"
python3 - "$ROOT/client/viewer/viewer.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "losslessEl.onclick = "
assert s.count(old) == 1, old
s = s.replace(old, "losslessEl.onpointerdown = () => controller.exactSource?.cancel();\n" + old)
open(p, "w").write(s)
PY
