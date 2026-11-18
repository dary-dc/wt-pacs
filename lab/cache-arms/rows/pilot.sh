#!/usr/bin/env bash
# cache-plan.md §8.4's pilot on one engine, each design's own rule (§8.8): bash lab/cache-arms/rows/pilot.sh chromium
set -euo pipefail
cd "$(dirname "$0")/../../.."
ENGINE=$1
OUT=lab/cache-arms/rows/$ENGINE/pilot
mkdir -p "$OUT"
export NODE_PATH=$(npm root -g)
STEP=""

run() { # arm cell size settings tag rep
  local f=$OUT/$1.$2-$3$STEP.$5.$6.jsonl
  [ -s "$f" ] && grep -q '"unit"' "$f" && return
  node lab/cache-arms/run.mjs --engine "$ENGINE" --cell "$2" --size "$3" --rounds 1 --arms "$1" --pilot "$4" --out "$f" >/dev/null 2>&1 || true
}
alternate() { # arm cell size a b
  local i=0
  for t in a b b a a b; do
    i=$((i + 1)); if [ $t = a ]; then run "$1" "$2" "$3" "$4" a $i; else run "$1" "$2" "$3" "$5" b $i; fi
  done
}
pick() { # arm cell size measure a b → the pick (a tie within 10 % keeps a)
  python3 lab/cache-arms/rows/pilot_pick.py "$OUT" "$1" "$2-$3$STEP" "$4" "$5" "$6"
}
join() { local a=$1 b=$2; [ -z "$a" ] && echo "$b" || { [ -z "$b" ] && echo "$a" || echo "$a&$b"; }; }

alternate opfs-sync R-busy 2560 "" "piece=2MiB"
SYNC=$(pick opfs-sync R-busy 2560 piece "" "piece=2MiB")

alternate opfs-async W 512 "" "group=8MiB"
G=$(pick opfs-async W 512 write "" "group=8MiB")
alternate opfs-async W 2560 "$G" "$(join "$G" inflight=3)"
GI=$(pick opfs-async W 2560 write "$G" "$(join "$G" inflight=3)")
alternate opfs-async R-idle 2560 "$GI" "$(join "$GI" read=sync)"
ASYNC=$(pick opfs-async R-idle 2560 miss50 "$GI" "$(join "$GI" read=sync)")

IDB=""
if [ "$ENGINE" = firefox ]; then
  alternate idb W 2560 "" "value=buffer"
  IDB=$(pick idb W 2560 write "" "value=buffer")
fi

alternate cachestorage R-idle 2560 "" "inflight=3"
I=$(pick cachestorage R-idle 2560 writeread "" "inflight=3")
STEP=-body
alternate cachestorage R-idle 2560 "$I" "$(join "$I" body=streamed)"
CS=$(pick cachestorage R-idle 2560 writeread-streamed "$I" "$(join "$I" body=streamed)")

python3 -c 'import json,sys; print(json.dumps(dict(zip(["opfs-sync","opfs-async","idb","cachestorage"], sys.argv[1:])), indent=1))' \
  "$SYNC" "$ASYNC" "$IDB" "$CS" > "lab/cache-arms/pilot-$ENGINE.json"
cat "lab/cache-arms/pilot-$ENGINE.json"
