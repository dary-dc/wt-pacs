#!/usr/bin/env bash
# SCROLLPOLICY's campaigns, the run docs/WIRE.md §What a scroll ahead asks pre-registers; read by scrollpolicy.py.
#   lab/ask-ahead/scrollpolicy.sh DBT10_DIR aa|main|ceiling > rows-scrollpolicy-{aa,main,ceiling}.jsonl
# Needs a release `series-server` built with `--features lab-levers` (SERVER=PATH, frozen), and cells.py's other needs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export RELAY_CHRT="${RELAY_CHRT:-50}" ASK_AT=0.1
Q="--fill-resumes-after-asks --send-window-follows-cwnd ?refill=none"
export ARMS="E=?refill=head,Ep=?refill=head,C=?refill=head ?scroll=cursor,F=?refill=head ?scroll=aim,\
QE=$Q,QEp=$Q,QC=$Q ?scroll=cursor,QF=$Q ?scroll=aim"
case "$2" in
  aa) today=":E,Ep" qw=":QE,QEp" rounds=7 ;;
  main) today=":E,Ep,C,F" qw=":QE,QEp,QC,QF" rounds=10 ;;
  ceiling) exec python3 "$HERE/cells.py" "$1" 3 "18/2/fifo20@none:E" "103/2/fifo20@none:E" "200/2/fifo20@none:E" ;;
esac
cells=()
# A step slower, then faster, than the fill's R ÷ S: 3.9 frames a second at 18 Mbit/s, 22 at 103.
for step in 18/500 18/100 103/100 103/20; do
  rate=${step%/*} ms=${step#*/}
  cells+=("$rate/46/fifo20@10#scroll$ms$today" "$rate/46/fifo20@10#scroll$ms$qw")
done
exec python3 "$HERE/cells.py" "$1" "$rounds" "${cells[@]}"
