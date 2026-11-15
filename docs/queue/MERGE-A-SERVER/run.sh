#!/usr/bin/env bash
set -uo pipefail
W=/home/user/merge-a-server; O=<scratch>/out
cd "$W"; git rev-parse HEAD > "$O/commit"
export PYTHON=python3.13 CARGO_TARGET_DIR=/home/user/target-merge-a-server NODE_PATH=/opt/node22/lib/node_modules
ts() { date -u +%H:%M:%SZ; }
echo "$(ts) start" > "$O/progress"
[[ -f client/transport/wasm/build.sh ]] && bash client/transport/wasm/build.sh > "$O/wasm-transport.log" 2>&1; echo "transport-wasm $?" >> "$O/progress"
for f in client/decode/wasm/fetch_openjph.sh client/decode/wasm/fetch_xxh3.sh; do [[ -f $f ]] && bash $f >> "$O/vendor.log" 2>&1; echo "vendor $f $?" >> "$O/progress"; done
bash client/decode/wasm/build/build.sh > "$O/wasm-decode.log" 2>&1; echo "decode-wasm $?" >> "$O/progress"
git status --porcelain > "$O/dirty-after-builds"
bash ingest/tools.sh > "$O/ingest-tools.log" 2>&1; echo "$(ts) ingest-tools $?" >> "$O/progress"
t=$SECONDS; scripts/gate.sh > "$O/gate.log" 2>&1; rc=$?; echo "$(ts) gate $rc $((SECONDS-t))s" >> "$O/progress"
cargo build 2> "$O/cargo-build.log" >/dev/null; echo "cargo-build $? warnings $(grep -cE '^warning' "$O/cargo-build.log")" >> "$O/progress"
[[ -x scripts/check_lab_absent.sh ]] && { scripts/check_lab_absent.sh > "$O/lab-absent.log" 2>&1; echo "lab-absent $?" >> "$O/progress"; }
scripts/comment_budget.sh > "$O/comment-budget.log" 2>&1; echo "comment-budget $?" >> "$O/progress"
echo "$(ts) end" >> "$O/progress"
