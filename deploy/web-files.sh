#!/usr/bin/env bash
# Copies what the viewer loads from client/, and nothing else, into DEST/client: the web image's root and --local's.
# The clients' builds are not among them: the image builds its own (TS's build.sh --product, the wasm stage's pkg/).
# usage: deploy/web-files.sh DEST
set -euo pipefail
DEST="$(mkdir -p "$1" && cd "$1" && pwd)/client"
cd "$(dirname "$0")/../client"
# check-page.js and view/check.js load on `?check=` alone, paint/reference.js on it and on a view's `valueAt`.
FILES=(
  viewer/index.html viewer/head.js viewer/viewer.js viewer/check-page.js
  transport/consumer.js transport/downloader.js transport/wasm/session-adapter.js
  decode/*.js decode/wasm/build/manifest.sha256 decode/wasm/built
  paint/painter.js paint/paint-worker.js paint/voi.js paint/reference.js
  view/controller.js view/store.js view/view.js view/view-worker.js view/check.js
)
for f in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp -R "$f" "$DEST/$f"
done
