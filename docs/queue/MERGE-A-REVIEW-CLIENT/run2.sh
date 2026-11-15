#!/usr/bin/env bash
# MERGE-A-REVIEW-CLIENT: run.sh from the gate on, after the decode WASM was built through mirror.gcr.io at the pinned digest
set -uo pipefail
W=/home/user/mac; O=/home/user/rev/out; mkdir -p $O; cd $W; git rev-parse HEAD > $O/commit
export PYTHON=python3.13 CARGO_TARGET_DIR=/home/user/target-mac NODE_PATH=/opt/node22/lib/node_modules
ts() { date -u +%H:%M:%SZ; }
echo "$(ts) start" >> $O/progress
t=$SECONDS; scripts/gate.sh > $O/gate.log 2>&1; rc=$?; echo "$(ts) gate $rc $((SECONDS-t))s" >> $O/progress
cargo build 2> $O/cargo-build.log >/dev/null; echo "cargo-build $? warnings $(grep -cE '^warning' $O/cargo-build.log)" >> $O/progress
scripts/check_lab_absent.sh > $O/lab-absent.log 2>&1; echo "lab-absent $?" >> $O/progress
scripts/comment_budget.sh > $O/comment-budget.log 2>&1; echo "comment-budget $?" >> $O/progress
mkdir -p /home/user/tips && ln -sfn $W /home/user/tips/mac
bash /home/user/ledger/docs/queue/MERGE-BASELINE/counts.sh mac > $O/counts.md 2>&1; echo "$(ts) counts $?" >> $O/progress
echo "$(ts) end" >> $O/progress
