#!/usr/bin/env bash
# REPORT-RUN-2: report-plan.md §7.9's cells in its order. Rows land in $W/lab/report-arms/rows/r2-*.jsonl.
# W: a worktree of claude/report-arms; NGINX_BIN: nginx 1.31.8; FIREFOX_PATH: Firefox 160.0.1; LOG: a scratch dir.
# RW: a second worktree whose every parent nginx's unprivileged worker can traverse (R's NGINX writes its own lines).
set -u
cd "$W"
export CARGO_TARGET_DIR=$W/target NGINX_BIN FIREFOX_PATH
R=lab/report-arms/rows; mkdir -p $R "$LOG"
C="beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H"
ALL="off,$C,off'"
run() { node lab/report-arms/run.mjs --receiver receiver --wait 60 "$@" >/dev/null 2>>"$LOG/run-stderr.log"; }
complete() { [ -f "$1" ] && grep -q "$2" "$1"; }
keep_partial() { [ -f "$1" ] && mv "$1" "${1%.jsonl}.partial-$(date -u +%m%d%H%M).jsonl"; true; }
cell() {
  local engine=$1 e=$2; shift 2
  local f=$R/r2-$engine-$e.jsonl
  complete $f '"cell"' && return
  keep_partial $f
  run --engine $engine --units "$ALL" --endings $e --rounds 18 --out $f "$@"
}
for E in ${CHROMIUM:-D5a D5b L Lbusy C}; do cell chromium $E; done
if ! complete $R/r2-R.jsonl '"done"'; then
  keep_partial $R/r2-R.jsonl
  (cd "${RW:-$W}" && node lab/report-arms/receivers.mjs --bodies $R/r-bodies.jsonl --rounds 6 --out "$W/$R/r2-R.jsonl") >/dev/null 2>>"$LOG/run-stderr.log" \
    && echo '{"done":"R"}' >> $R/r2-R.jsonl
fi
for E in ${CHROMIUM_TUN:-D6}; do cell chromium $E --tun; done
M=$R/r2-firefox-mutants.jsonl
if ! complete $M '"mutants":"done"'; then
  keep_partial $M
  f() { run --engine firefox "$@" --out $M; }
  f --units "$C" --endings D1 --mutant never-sent
  f --units "off,$C" --endings D1 --mutant safety-sampled
  f --units "$C" --endings D1 --mutant field-outside
  f --units "$C" --endings D1 --mutant no-reportId
  f --units "off,beacon:H,beacon:Y,keepalive:H,keepalive:Y" --endings D1 --sink-mutant ack-before-write
  WTPACS_SESSION_REPORT_MUTANT=ack-before-write run --engine firefox --units "session:1,session:Y,session:H" --endings D1 --out $M.session-ack
  sed 's/"mutant":null/"mutant":"ack-before-write (server)"/' $M.session-ack >> $M && rm $M.session-ack
  echo '{"mutants":"done"}' >> $M
fi
for E in ${FIREFOX:-D1 D2 D9 D4 D5b D8 D5a D3 D7 L Lbusy C}; do cell firefox $E; done
for E in ${FIREFOX_TUN:-D6}; do cell firefox $E --tun; done
echo done > "$LOG/finished"
