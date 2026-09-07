#!/usr/bin/env bash
# Does the shipped path land where the arm that won it did?
#
# The `product` arm drives server's own ReadCtx, exactly as stream_codestream drives it, so
# this compares the thing that ships against the candidates rather than against a model of
# itself.
#
# The stride matters more than it looks. This host reads ahead 8 MB
# (/sys/block/vda/queue/read_ahead_kb), so at the campaign's usual 250 KB stride one blocking
# read warms the next ~33 asks and a "cold" cell measures 2% misses, not 99%. The miss cells
# below stride past that window; the hit cells are warm. Check read_ahead_kb before trusting
# any miss cell on a new host.
set -euo pipefail
cd /home/user/wt-pacs
SP=/tmp/claude-0/-home-user-wt-pacs/f3861f8b-acf0-5176-a6af-c8aa8552087f/scratchpad
BIN=./target/release/read_campaign
DEEP=lab/fixtures/frames_250k_deep/frames_250k_deep.sbnd
OUT=$SP/v30_product.tsv
ARMS=pool,hybrid,hybrid_lazyring,uring,product
: > $OUT
first=1
emit() { local label=$1; shift
  if [[ $first -eq 1 ]]; then $BIN --study $DEEP --label "$label" "$@" >> $OUT; first=0
  else $BIN --study $DEEP --label "$label" --no-header "$@" >> $OUT; fi
  echo "  done $label" >&2
}
# hit regime: warm, the stride the published campaign used
emit hit_16k  --arms $ARMS --depths 1 --readers 1,8 --temps warm --size 16384  --stride 250000 --asks 256 --repeats 5 --monitors 0
emit hit_250k --arms $ARMS --depths 1 --readers 1,8 --temps warm --size 250000 --stride 250000 --asks 128 --repeats 5 --monitors 0
# miss regime: cold, stride past this host's 8 MB readahead window
emit miss_16k  --arms $ARMS --depths 1 --readers 1,8 --temps cold --size 16384  --stride 4194304 --asks 256 --repeats 5 --monitors 0
emit miss_250k --arms $ARMS --depths 1 --readers 1,8 --temps cold --size 250000 --stride 4194304 --asks 128 --repeats 5 --monitors 0
echo "rows: $(wc -l < $OUT)" >&2
