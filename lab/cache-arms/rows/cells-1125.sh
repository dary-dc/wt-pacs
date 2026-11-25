#!/usr/bin/env bash
# page-runs.md §5 (CACHE-CELLS): the rig's mutants on the run's arms, then the counted cells, one engine:
#   bash lab/cache-arms/rows/cells-1125.sh chromium mutants|L-512|L-2560|T|O-512|O-3328
# A cell's rows land in <name>.running, move to <name>.jsonl when it ends, and are committed and pushed.
set -uo pipefail
cd "$(dirname "$0")/../../.."
ENGINE=$1 WHAT=$2
OUT=lab/cache-arms/rows/$ENGINE-1125
PILOT=lab/cache-arms/pilot-$ENGINE.json
export NODE_PATH=$(npm root -g)
L_ARMS=none,opfs-sync,opfs-sync-aa,opfs-async
mkdir -p "$OUT/mutants"

run() { # name args...
  local name=$1; shift
  [ -s "$OUT/$name.jsonl" ] && return
  [ -e "$OUT/$name.running" ] && mv "$OUT/$name.running" "$OUT/$name.partial-$(date -u +%H%MZ).jsonl"
  echo "$(date -u +%FT%TZ) start $name"
  node lab/cache-arms/run.mjs --engine "$ENGINE" --pilot "$PILOT" --out "$OUT/$name.running" "$@" && mv "$OUT/$name.running" "$OUT/$name.jsonl"
  echo "$(date -u +%FT%TZ) end $name"
  git add "$OUT" && git commit -qm "lab/cache-arms/rows/$ENGINE-1125: $name (CACHE-CELLS)" && { git pull -q --rebase origin claude/cache-arms; git push -q origin HEAD:claude/cache-arms; }
}

case $WHAT in
  mutants)
    run mutants/slot-held-L --mutant slot-held --cell L --size 2560 --throttle 1 --arms $L_ARMS --rounds 1
    run mutants/view-copy-L --mutant view-copy --cell L --size 2560 --throttle 1 --arms $L_ARMS --rounds 1
    run mutants/drop-writes-O --mutant drop-writes --cell O --size 3328 --throttle 1 --arms opfs-sync,opfs-async --rounds 1
    run mutants/tab-writes-T --mutant tab-writes --cell T --size 2560 --throttle 1 --arms opfs-sync --rounds 1 ;;
  L-512) run L-512-1x --cell L --size 512 --throttle 1 --arms $L_ARMS --rounds 12 ;;
  L-2560) run L-2560-1x --cell L --size 2560 --throttle 1 --arms $L_ARMS --rounds 12 ;;
  T) run T-2560-1x --cell T --size 2560 --throttle 1 --arms opfs-sync --rounds 12 ;;
  O-512) run O-512-1x --cell O --size 512 --throttle 1 --arms opfs-sync,opfs-sync-aa,opfs-async --rounds 6 ;;
  O-3328) run O-3328-1x --cell O --size 3328 --throttle 1 --arms opfs-sync,opfs-sync-aa,opfs-async --rounds 6 ;;
esac
