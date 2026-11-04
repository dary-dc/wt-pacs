#!/usr/bin/env bash
# The protocol's stage-2 mutations, dbts_a1 at r50000 1×, one visit each; rows annotated with the mutation.
set -euo pipefail
cd /home/user/wt-pacs
OUT=lab/av1/delivery/top-first/mutations.jsonl
: > $OUT
run() {
  local m=$1 arms=$2 tmp; tmp=$(mktemp)
  NODE_PATH=$(npm root -g) node lab/av1/delivery/top-first/run.mjs --frames lab/.av1-work/top-first --sets dbts_a1 --links r50000 \
    --throttles 1 --variants "$arms" --per-frame --rounds 1 --mutate "$m" --out "$tmp" 2>&1 | grep "^round" || true
  python3 -c "import json,sys; [print(json.dumps({'mutate': sys.argv[1], **json.loads(l)})) for l in open(sys.argv[2])]" "$m" "$tmp" >> $OUT
  rm -f "$tmp"
}
run sample k2,tf-frame,tf-series
run preview-or1 tf-frame,tf-series
run preview-shift1 tf-frame,tf-series
run join-next tf-series
run drop-low tf-frame,tf-series
run preview-late tf-frame,tf-series
run preview-unmarked tf-frame,tf-series
