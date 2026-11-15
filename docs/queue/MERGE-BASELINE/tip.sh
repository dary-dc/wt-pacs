#!/usr/bin/env bash
# tip.sh BRANCH: build per README cloud lines, run the gate and the measures; logs in /home/user/scratch-base/BRANCH/
set -uo pipefail
b=$1; W=/home/user/tips/$b; O=/home/user/scratch-base/$b
mkdir -p "$O"; cd /home/user/wt-pacs
[[ -d $W ]] || git worktree add --detach "$W" "origin/claude/$b" >/dev/null 2>&1
cd "$W"; git rev-parse HEAD > "$O/commit"
export PYTHON=python3.13 CARGO_TARGET_DIR=/home/user/target-base NODE_PATH=/opt/node22/lib/node_modules
ts() { date -u +%H:%M:%SZ; }
echo "$(ts) start" > "$O/progress"
[[ -f client/transport/wasm/build.sh ]] && bash client/transport/wasm/build.sh > "$O/wasm-transport.log" 2>&1; echo "transport-wasm $?" >> "$O/progress"
for f in client/decode/wasm/fetch_openjph.sh client/decode/wasm/fetch_xxh3.sh; do [[ -f $f ]] && bash $f >> "$O/vendor.log" 2>&1; echo "vendor $f $?" >> "$O/progress"; done
bash client/decode/wasm/build/build.sh > "$O/wasm-decode.log" 2>&1; echo "decode-wasm $?" >> "$O/progress"
git status --porcelain > "$O/dirty-after-builds"
bash ingest/tools.sh > "$O/ingest-tools.log" 2>&1; echo "$(ts) ingest-tools $?" >> "$O/progress"
t=$SECONDS; scripts/gate.sh > "$O/gate.log" 2>&1; rc=$?; echo "$(ts) gate $rc $((SECONDS-t))s" >> "$O/progress"
if [[ $rc -ne 0 ]] && grep -qiE 'browser|chromium|playwright' <(tail -30 "$O/gate.log"); then
  t=$SECONDS; scripts/gate.sh --no-browser > "$O/gate-nobrowser.log" 2>&1; echo "$(ts) gate-no-browser $? $((SECONDS-t))s" >> "$O/progress"
fi
cargo build 2> "$O/cargo-build.log" >/dev/null; echo "cargo-build $? warnings $(grep -cE '^warning' "$O/cargo-build.log")" >> "$O/progress"
scripts/check_lab_absent.sh > "$O/lab-absent.log" 2>&1; echo "lab-absent $?" >> "$O/progress"
scripts/comment_budget.sh > "$O/comment-budget.log" 2>&1; echo "comment-budget $?" >> "$O/progress"
for tg in server web; do
  t=$SECONDS; DOCKER_BUILDKIT=1 docker build --network host -q -f deploy/Containerfile --target $tg -t "base-$b-$tg" \
    --secret id=build_ca,src=/root/.ccr/ca-bundle.crt --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}" \
    --build-arg https_proxy="$HTTPS_PROXY" --build-arg http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" . > "$O/image-$tg.log" 2>&1; rc=$?
  echo "image-$tg $rc $((SECONDS-t))s $(docker image inspect -f '{{.Size}}' "base-$b-$tg" 2>/dev/null)" >> "$O/progress"
done
/home/user/scratch-base/counts.sh "$b" > "$O/counts.md" 2>&1; echo "counts $?" >> "$O/progress"
echo "$(ts) end" >> "$O/progress"
