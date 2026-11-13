#!/usr/bin/env bash
# R3's wake arm (docs/lines/proposals.md §R3): a host root beside TIP whose lossless button's `pointerdown` posts a
# `wake` to the exact session's downloader, which ends its stream and nothing else; the rest is TIP's. Page view only.
#
#   lab/proposals/r3_arm.sh TIP ROOT
set -euo pipefail
TIP=$1 ROOT=$2
mkdir -p "$ROOT/server"
rm -rf "$ROOT/client" && cp -a "$TIP/client" "$ROOT/client"
cp "$TIP/server/dev-server.py" "$ROOT/server/"
ln -sfn "$TIP/lab" "$ROOT/lab"
ln -sfn "$TIP/fixtures" "$ROOT/fixtures"
python3 - "$ROOT/client" <<'PY'
import sys
root = sys.argv[1]
def patch(f, old, new):
    p = f"{root}/{f}"
    s = open(p).read()
    assert s.count(old) == 1, (f, old)
    open(p, "w").write(s.replace(old, new))
patch("viewer/viewer.js", "losslessEl.onclick = ", "losslessEl.onpointerdown = () => controller.exactSource?.wake();\nlosslessEl.onclick = ")
patch("transport/consumer.js", "  stats() {", "  wake() {\n    this.#worker.postMessage({ kind: \"wake\" });\n  }\n\n  stats() {")
patch("transport/downloader.js", '    if (m.kind === "check") return void watch();',
      '    if (m.kind === "wake") return void (await session?.endStream().catch(() => {}));\n    if (m.kind === "check") return void watch();')
PY
