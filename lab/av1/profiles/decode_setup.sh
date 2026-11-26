#!/usr/bin/env bash
# Everything one block of the amended decode protocol needs on a fresh 4-core host (README.md §Shards): the client's
# decoders, the encoders and native dav1d, the three volumes, their streams, and the pinned browser. ~20 min here.
#
#   lab/av1/profiles/decode_setup.sh        then: source lab/.av1-work/decode-env.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
H="$ROOT/client/decode/wasm/build"
WORK="$ROOT/lab/.av1-work/profiles-decode"
PW="$ROOT/lab/.av1-work/playwright-1.56.1"
cd "$ROOT"

decoders() {
  if docker info >/dev/null 2>&1; then "$H/build.sh"; return; fi
  # No container daemon: build.sh's own fetches and checks, then its inside.sh on this host; the manifest decides.
  local fetch
  fetch="$(sed -n '/^fetch_git()/,/^bash .*fetch_xxh3/p' "$H/build.sh")"
  (ROOT="$ROOT" HERE="$H" CACHE="$H/.cache" OUT="$ROOT/client/decode/wasm/built" bash -c "set -euo pipefail; source '$H/pins.sh'; mkdir -p \"\$CACHE\" \"\$OUT\"; $fetch")
  bash "$H/inside.sh" "$H/.cache" "$ROOT/client/decode/wasm/built" "$(id -u):$(id -g)"
  (cd "$ROOT/client/decode/wasm/built" && sha256sum -c --quiet "$H/manifest.sha256")
}

browser() {
  mkdir -p "$PW"
  (cd "$PW" && npm init -y >/dev/null && npm install -s playwright@1.56.1 \
    && PLAYWRIGHT_BROWSERS_PATH="$PW/browsers" npx playwright install chromium-headless-shell)
  printf 'export PLAYWRIGHT_BROWSERS_PATH=%q NODE_PATH=%q\n' "$PW/browsers" "$PW/node_modules" >"$ROOT/lab/.av1-work/decode-env.sh"
}

mkdir -p "$WORK"
command -v meson >/dev/null || python3 -m pip install -q meson==1.5.2
pids=()
decoders & pids+=($!)
lab/av1/tools/tools.sh aom dav1d & pids+=($!)
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 & pids+=($!)
browser & pids+=($!)
for p in "${pids[@]}"; do wait "$p"; done
lab/av1/.venv/bin/pip install -q --require-hashes -r lab/av1/profiles/requirements.txt
for a in "dbts_a1 8,16,32 12bit,top10" "dbts_b1 16,32,56 10bit" "dbts_c1 8,16,32 12bit,top10"; do
  set -- $a
  lab/av1/.venv/bin/python lab/av1/profiles/streams.py lab/.av1-build "$WORK" "lab/av1/data/$1" --rungs "$2" --forms "$3" \
    --groups 1,8,16 --no-lossless-av1 >/dev/null
done
echo "decode_setup.sh: ready; source lab/.av1-work/decode-env.sh"
