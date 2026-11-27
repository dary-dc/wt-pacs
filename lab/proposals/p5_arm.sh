#!/usr/bin/env bash
# P5's dial-after arm (docs/lines/proposals.md §P5, amendment 1): a host root beside TIP whose viewer.js dials the exact
# session on the first `shown` instead of at start; the rest is TIP's. dev-server.py serves from its own checkout.
#
#   lab/proposals/p5_arm.sh TIP ROOT
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
for old, new in [
    ("let shown = null;\n", "let shown = null;\nlet dialled = false;\n"),
    ("  shown: (s) => {\n    shown = s;\n", "  shown: (s) => {\n    shown = s;\n    if (pair && !dialled) (dialled = true), connectExact();\n"),
    ("view = new View(n, controller ?? worker);\nif (pair) connectExact();\n", "view = new View(n, controller ?? worker);\n"),
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(p, "w").write(s)
PY
