#!/usr/bin/env bash
# REPORT-RERUNS: page-runs.md §2's cells. Rows land in $W/lab/report-arms/rows/r3-*.jsonl; a cell is complete when its
# file holds its {"cell"} line; a cell cut by a host restart goes on at a round boundary.
# W: a worktree of claude/report-arms; NGINX_BIN: nginx 1.31.8; FIREFOX_PATH: Firefox 160.0.1; LOG: a scratch dir.
set -u
cd "$W"
export CARGO_TARGET_DIR=$W/target NGINX_BIN FIREFOX_PATH
R=lab/report-arms/rows; mkdir -p $R "$LOG"
ALL="off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H,off'"
C_UNITS="off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,keepalive-offdecoder:Y,off'"
complete() { [ -f "$1" ] && grep -q '"cell"' "$1"; }
# A partial cell goes on from its first incomplete round (run.mjs --from-round); that round's rows are kept apart.
from_round() {
  python3 - "$1" "$2" <<'PY'
import json, sys
f, n = sys.argv[1], len(sys.argv[2].split(","))
rows = [l for l in open(f) if l.strip()]
by = {}
for l in rows: by.setdefault(json.loads(l)["round"], []).append(l)
k = 0
while len(by.get(k, [])) == n: k += 1
open(f, "w").writelines(l for l in rows if json.loads(l)["round"] < k)
open(f.replace(".jsonl", f".cut-round{k}.jsonl"), "a").writelines(l for l in rows if json.loads(l)["round"] >= k)
print(k)
PY
}
cell() {
  local engine=$1 e=$2 units=$3 rounds=$4; shift 4
  local f=$R/r3-$engine-$e.jsonl from=0
  complete $f && return
  [ -s $f ] && from=$(from_round $f "$units")
  echo "$(date -u +%FT%TZ) start $engine $e from round $from" >> "$LOG/cells.log"
  node lab/report-arms/run.mjs --receiver receiver --wait 60 --engine $engine --units "$units" --endings $e \
    --rounds $rounds --from-round $from --out $f "$@" >/dev/null 2>>"$LOG/run-stderr.log"
  echo "$(date -u +%FT%TZ) end $engine $e $?" >> "$LOG/cells.log"
}
cell chromium D5a-busy "$ALL" 18
cell chromium Lbusy "$ALL" 18
cell chromium C "$C_UNITS" 28
for E in ${FIREFOX:-D5a D1 L}; do cell firefox $E "$ALL" 18; done
# Firefox D6 under --tun: every load's WebTransport to the relay's address timed out (NS_ERROR_NET_TIMEOUT); unrun.
echo done > "$LOG/finished"
