#!/usr/bin/env bash
# cache-plan.md §8's counted cells on one engine in §8.6's order, after its frozen pilot (§8.8):
#   bash lab/cache-arms/rows/counted.sh chromium [ONLY_MATCHING]
# A cell's rows land in <name>.running and move to <name>.jsonl when it ends; a .running found at start is a cut
# run, kept as .partial-<UTC> and counted in no bar.
set -uo pipefail
cd "$(dirname "$0")/../../.."
ENGINE=$1 ONLY=${2:-}
OUT=lab/cache-arms/rows/$ENGINE
PILOT=lab/cache-arms/pilot-$ENGINE.json
[ -s "$PILOT" ] || { echo "no frozen pilot $PILOT"; exit 1; }
export NODE_PATH=$(npm root -g)
SIX=none,opfs-sync,opfs-async,idb,cachestorage,opfs-sync-aa
FIVE=opfs-sync,opfs-async,idb,cachestorage,opfs-sync-aa
FOUR=opfs-sync,opfs-async,idb,cachestorage

cell() { # name cell size throttle arms [extra args]
  local name=$1; shift
  [ -n "$ONLY" ] && [[ $name != *$ONLY* ]] && return
  [ -s "$OUT/$name.jsonl" ] && return
  [ -e "$OUT/$name.running" ] && mv "$OUT/$name.running" "$OUT/$name.partial-$(date -u +%H%MZ).jsonl"
  echo "$(date -u +%FT%TZ) start $name"
  node lab/cache-arms/run.mjs --engine "$ENGINE" --cell "$1" --size "$2" --throttle "$3" --arms "$4" --pilot "$PILOT" \
    --out "$OUT/$name.running" "${@:5}" && mv "$OUT/$name.running" "$OUT/$name.jsonl"
  echo "$(date -u +%FT%TZ) end $name $?"
}

cell L-2560-1x L 2560 1 $SIX --rounds 12
cell L-512-1x L 512 1 $SIX
cell L-3328-1x L 3328 1 $SIX
cell L-512-4x L 512 4 $SIX
cell L-2560-4x-none L 2560 4 none --rounds 6
cell L-3328-4x-none L 3328 4 none --rounds 6
cell W-2560-1x W 2560 1 $SIX
cell W-512-1x W 512 1 $SIX
cell W-3328-1x W 3328 1 $SIX
cell R-busy-2560-1x R-busy 2560 1 $FIVE
cell R-busy-3328-1x R-busy 3328 1 $FIVE
cell R-idle-2560-1x R-idle 2560 1 $FIVE
cell R-idle-512-1x R-idle 512 1 $FIVE
cell R-idle-3328-1x R-idle 3328 1 $FIVE
cell R-idle-512-4x R-idle 512 4 $FIVE
cell O-3328-1x O 3328 1 $FIVE
cell O-512-1x O 512 1 $FIVE
cell B-2560-1x B 2560 1 $SIX
cell E-3328-1x E 3328 1 $FOUR
cell K-3328-1x K 3328 1 $FOUR
cell Q-2560-1x Q 2560 1 $FOUR
cell T-2560-1x T 2560 1 $FOUR
cell P-2560-1x P 2560 1 $FOUR
