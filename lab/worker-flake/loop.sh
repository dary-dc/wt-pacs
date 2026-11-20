#!/usr/bin/env bash
# WORKER-FLAKE's loop: one demo-check cell run N times, a JSON row a run appended to OUT. docs/reviews/worker-flake.md
#
#   lab/worker-flake/loop.sh N OUT [demo-check.mjs's options, default: demo-series dbts_a1-q8-g16-cut --view worker]
set -uo pipefail
cd "$(dirname "$0")/../.."
n=$1 out=$2
shift 2
args=("${@:-demo-series dbts_a1-q8-g16-cut --view worker}")
[[ $# -gt 0 ]] || read -ra args <<<"${args[0]}"
for ((k = 1; k <= n; k++)); do
  t=$(date -u +%FT%TZ) s=$SECONDS
  log=$(NODE_PATH=$(npm root -g) timeout 600 node client/viewer/demo-check.mjs "${args[@]}" --json 2>&1)
  code=$?
  jq -cn --arg t "$t" --argjson k "$k" --argjson code "$code" --argjson s "$((SECONDS - s))" --arg args "${args[*]}" --arg log "$log" \
    '($log | split("\n")) as $l | {run: $k, at: $t, exit: $code, seconds: $s, args: $args,
      fail: [$l[] | select(startswith("FAIL ")) | .[5:]], other: [$l[] | select(startswith("{") or startswith("FAIL ") | not)]}
      + ([$l[] | select(startswith("{")) | fromjson?] | first // {})' >>"$out"
done
