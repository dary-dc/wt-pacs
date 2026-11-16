#!/usr/bin/env bash
# REPORT-RUN: the mutants on D1, then the endings in §7.8's order. Rows land in lab/report-arms/rows/ of the worktree.
set -u
cd /home/user/ra
export CARGO_TARGET_DIR=$PWD/target NGINX_BIN=$SCRATCH/ngx/inst/sbin/nginx
R=lab/report-arms/rows; mkdir -p $R
C="beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H"
ALL="off,$C,off'"
run() { node lab/report-arms/run.mjs --receiver receiver --wait 60 "$@" >/dev/null 2>>$SCRATCH/run-stderr.log; }
if [ "${SKIP_MUTANTS:-0}" != 1 ]; then
  M=$R/chromium-mutants.jsonl
  run --units "$C" --endings D1 --mutant never-sent --out $M
  run --units "off,$C" --endings D1 --mutant safety-sampled --out $M
  run --units "$C" --endings D1 --mutant field-outside --out $M
  run --units "$C" --endings D1 --mutant no-reportId --out $M
  run --units "off,beacon:H,beacon:Y,keepalive:H,keepalive:Y" --endings D1 --sink-mutant ack-before-write --out $M
  WTPACS_SESSION_REPORT_MUTANT=ack-before-write run --units "session:1,session:Y,session:H" --endings D1 --out $M.session-ack
  sed 's/"mutant":null/"mutant":"ack-before-write (server)"/' $M.session-ack >> $M && rm $M.session-ack
  echo '{"mutants":"done"}' >> $M
fi
for E in ${ENDINGS:-D1 D2 D7 D9 D4 D5b D8 D3 D5a}; do
  [ -f $R/chromium-$E.jsonl ] && grep -q '"cell"' $R/chromium-$E.jsonl && continue
  [ -f $R/chromium-$E.jsonl ] && mv $R/chromium-$E.jsonl $R/chromium-$E.partial-$(date -u +%H%M).jsonl
  run --units "$ALL" --endings $E --rounds 18 --out $R/chromium-$E.jsonl
done
echo done > $SCRATCH/finished
