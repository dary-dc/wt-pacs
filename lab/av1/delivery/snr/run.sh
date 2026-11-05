#!/usr/bin/env bash
# Row SNRPREVIEW, one shard (docs/av1/snr-preview.md §Shards):
#   SHARD=k ROUNDS_PER_SHARD=N BUDGET_S=16200 lab/av1/delivery/snr/run.sh tools content mutate rounds
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
BUILD="$ROOT/lab/.av1-build" P=lab/av1/.venv/bin/python W=lab/.av1-work D=lab/av1/delivery/snr
SETS=(lab/av1/data/dbts_a1 lab/av1/data/dbts_b1 lab/av1/data/dbts_c1)
SW=$W/snr RESULTS=$D/results
STEPS=" ${*:-tools content mutate rounds} "
want() { [[ "$STEPS" == *" $1 "* ]]; }
t() { local s=$SECONDS; "$@"; echo "TIME $((SECONDS - s)) s: $*" >&2; }

if want tools; then
  t lab/av1/delivery/carriers/run.sh tools
fi
if want content; then
  t $P lab/av1/delivery/split-rule/make_frames.py "$BUILD" $W/shipped "${SETS[@]}" --preset allintra:7 --k 2 --jobs 3
  t $P $D/snr_content.py code "$BUILD" $W/shipped $SW "${SETS[@]}"
fi
if want mutate; then
  python3 $D/rule_test.py && python3 $D/mutate_rule.py
  for m in sample truth offset skip low unit; do
    NODE_PATH=$(npm root -g) node $D/snr.mjs --work $SW --first-round 0 --sets dbts_a1 --gs 8 --vls 8 --mutate $m \
      --out "$RESULTS/shard-$SHARD.mutations.jsonl"
  done
  python3 $D/mutations.py "$RESULTS/shard-$SHARD.mutations.jsonl"
  [[ "${SHARD:?}" == 1 ]] && for v in dbts_a1 dbts_b1 dbts_c1; do cp $SW/$v.json "$RESULTS/shard-1.index.$v.json"; done
fi
if want rounds; then
  # Shard k runs rounds (k − 1)·N … k·N − 1; it stops after a whole round once less than one round's time is left
  # before BUDGET_S, seconds since run.sh started.
  N=${ROUNDS_PER_SHARD:?} first=$(( (SHARD - 1) * N )) end=${BUDGET_S:?}
  for r in $(seq $first $(( first + N - 1 ))); do
    s=$SECONDS
    NODE_PATH=$(npm root -g) node $D/snr.mjs --work $SW --first-round "$r" --out "$RESULTS/shard-$SHARD.jsonl"
    (( end - SECONDS < SECONDS - s )) && { echo "stopped after round $r: budget" >&2; break; }
  done
fi
