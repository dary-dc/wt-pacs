#!/usr/bin/env bash
# REPORT-RERUNS: page-runs.md §2's cells. Rows land in $W/lab/report-arms/rows/r3-*.jsonl; a cell is complete when its
# file holds its {"cell"} line, and a partial one is kept renamed, counted in no bar.
# W: a worktree of claude/report-arms; NGINX_BIN: nginx 1.31.8; FIREFOX_PATH: Firefox 160.0.1; LOG: a scratch dir.
set -u
cd "$W"
export CARGO_TARGET_DIR=$W/target NGINX_BIN FIREFOX_PATH
R=lab/report-arms/rows; mkdir -p $R "$LOG"
ALL="off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H,off'"
C_UNITS="off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,keepalive-offdecoder:Y,off'"
complete() { [ -f "$1" ] && grep -q '"cell"' "$1"; }
keep_partial() { [ -f "$1" ] && mv "$1" "${1%.jsonl}.partial-$(date -u +%m%d%H%M).jsonl"; true; }
cell() {
  local engine=$1 e=$2 units=$3 rounds=$4; shift 4
  local f=$R/r3-$engine-$e.jsonl
  complete $f && return
  keep_partial $f
  echo "$(date -u +%FT%TZ) start $engine $e" >> "$LOG/cells.log"
  node lab/report-arms/run.mjs --receiver receiver --wait 60 --engine $engine --units "$units" --endings $e \
    --rounds $rounds --out $f "$@" >/dev/null 2>>"$LOG/run-stderr.log"
  echo "$(date -u +%FT%TZ) end $engine $e $?" >> "$LOG/cells.log"
}
cell chromium D5a-busy "$ALL" 18
cell chromium Lbusy "$ALL" 18
cell chromium C "$C_UNITS" 28
for E in ${FIREFOX:-D5a D1 L}; do cell firefox $E "$ALL" 18; done
cell firefox D6 "$ALL" 18 --tun
echo done > "$LOG/finished"
