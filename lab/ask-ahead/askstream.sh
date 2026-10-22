#!/usr/bin/env bash
# ASKSTREAM's campaign, the run docs/WIRE.md §Proposed: an ask during a fill pre-registered; read by askstream.py.
#   lab/ask-ahead/askstream.sh DBT10_DIR DBTS_B1_DIR > rows-askstream.jsonl   (FIRST_ROUND=k resumes at round k)
# Needs a release `series-server` built with `--features lab-levers`, and cells.py's other needs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export RELAY_CHRT="${RELAY_CHRT:-50}" MORE_SERIES="dbts=$2"
export ARMS="T=?refill=head,Tp=?refill=head,QW=--fill-resumes-after-asks --send-window-follows-cwnd ?refill=none,\
QS=--fill-resumes-after-asks --ask-stream-priority 1 ?refill=none,QS0=--fill-resumes-after-asks --ask-stream-priority 0 ?refill=none"
four=":T,Tp,QW,QS"
five=":T,Tp,QW,QS,QS0"
cells=()
for rate in 18 103; do for rtt in 46 92; do for queue in fifo20 codel; do for at in 10 50; do
  [[ "$rate/$rtt/$queue@$at" == 18/46/fifo20@50 ]] && arms=$five || arms=$four
  cells+=("$rate/$rtt/$queue@$at$arms")
done; done; done; done
cells+=("103/46/fifo360@50$four" "103/46/fifo800@50$four")
cells+=("18/46/fifo20/loss1@50$five" "103/46/fifo20/loss1@50$four")
cells+=("18/46/fifo20~dbts@50$five" "103/46/fifo20~dbts@50$four")
for link in 18/46/fifo20 103/46/fifo20 18/46/fifo20/loss1; do
  cells+=("$link@50#u1$four" "$link@50#u3$four")
done
exec python3 "$HERE/cells.py" "$1" 10 "${cells[@]}"
