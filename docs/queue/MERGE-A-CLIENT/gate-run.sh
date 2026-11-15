#!/usr/bin/env bash
# tip.sh BRANCH: build per README cloud lines, run the gate and the measures; logs in /home/user/scratch-base/BRANCH/
set -uo pipefail
b=$1; W=/home/user/mac; O=/home/user/mac-out
mkdir -p "$O"; cd /home/user/wt-pacs

cd "$W"; git rev-parse HEAD > "$O/commit"
export PYTHON=python3.13 CARGO_TARGET_DIR=/home/user/target-mac NODE_PATH=/opt/node22/lib/node_modules
ts() { date -u +%H:%M:%SZ; }
t=$SECONDS; scripts/gate.sh > "$O/gate.log" 2>&1; rc=$?; echo "$(ts) gate $rc $((SECONDS-t))s" >> "$O/progress"
if [[ $rc -ne 0 ]] && grep -qiE 'browser|chromium|playwright' <(tail -30 "$O/gate.log"); then
  t=$SECONDS; scripts/gate.sh --no-browser > "$O/gate-nobrowser.log" 2>&1; echo "$(ts) gate-no-browser $? $((SECONDS-t))s" >> "$O/progress"
fi
cargo build 2> "$O/cargo-build.log" >/dev/null; echo "cargo-build $? warnings $(grep -cE '^warning' "$O/cargo-build.log")" >> "$O/progress"
scripts/check_lab_absent.sh > "$O/lab-absent.log" 2>&1; echo "lab-absent $?" >> "$O/progress"
scripts/comment_budget.sh > "$O/comment-budget.log" 2>&1; echo "comment-budget $?" >> "$O/progress"
for tg in; do
  t=$SECONDS; DOCKER_BUILDKIT=1 docker build --network host -q -f deploy/Containerfile --target $tg -t "base-$b-$tg" \
    --secret id=build_ca,src=/root/.ccr/ca-bundle.crt --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}" \
    --build-arg https_proxy="$HTTPS_PROXY" --build-arg http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" . > "$O/image-$tg.log" 2>&1; rc=$?
  echo "image-$tg $rc $((SECONDS-t))s $(docker image inspect -f '{{.Size}}' "base-$b-$tg" 2>/dev/null)" >> "$O/progress"
done

echo "$(ts) end" >> "$O/progress"
