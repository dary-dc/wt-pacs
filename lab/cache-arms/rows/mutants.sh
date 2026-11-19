#!/usr/bin/env bash
# cache-plan.md §8.4's mutants on one engine, one round per arm (K two: it damages a frame in odd rounds only):
#   bash lab/cache-arms/rows/mutants.sh chromium [ONLY_MATCHING]
set -uo pipefail
cd "$(dirname "$0")/../../.."
ENGINE=$1 ONLY=${2:-}
OUT=lab/cache-arms/rows/$ENGINE/mutants
PILOT=lab/cache-arms/pilot-$ENGINE.json
mkdir -p "$OUT"
export NODE_PATH=$(npm root -g)
FOUR=opfs-sync,opfs-async,idb,cachestorage

mutant() { # name mutant cell size arms rounds
  local name=$1
  [ -n "$ONLY" ] && [[ $name != *$ONLY* ]] && return
  [ -s "$OUT/$name.jsonl" ] && return
  [ -e "$OUT/$name.running" ] && mv "$OUT/$name.running" "$OUT/$name.partial-$(date -u +%H%MZ).jsonl"
  echo "$(date -u +%FT%TZ) start $name"
  node lab/cache-arms/run.mjs --engine "$ENGINE" --mutant "$2" --cell "$3" --size "$4" --throttle 1 --arms "$5" \
    --rounds "$6" --pilot "$PILOT" --out "$OUT/$name.running" && mv "$OUT/$name.running" "$OUT/$name.jsonl"
  echo "$(date -u +%FT%TZ) end $name $?"
}

mutant drop-writes-W drop-writes W 2560 $FOUR 1
mutant drop-writes-O drop-writes O 3328 $FOUR 1
mutant no-recheck-K no-recheck K 3328 $FOUR 2
mutant slot-held-L slot-held L 2560 none,$FOUR 1
mutant view-copy-L view-copy L 2560 none,$FOUR 1
mutant evict-newest-E evict-newest E 3328 $FOUR 1
mutant tab-writes-T tab-writes T 2560 $FOUR 1
