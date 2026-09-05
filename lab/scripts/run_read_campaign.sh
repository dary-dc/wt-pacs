#!/usr/bin/env bash
# Read-path campaign: every phase, one TSV.
#
# Cost cells run with `--monitors 0` and safety cells with `--monitors 1`, deliberately:
# the co-tenant monitor is a spin loop whose CPU is proportional to a cell's wall time, so
# leaving it on would charge slow arms for the monitor's own spinning and call it their CPU.
# `docs/disk-access/README.md` states the same rule for the older harness.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/target/release/read_campaign"
BIG="${BIG:-$ROOT/lab/fixtures/frames_16k_big/frames_16k_big.sbnd}"
OUT="${OUT:-$ROOT/docs/disk-access/v10_campaign.tsv}"
REPEATS="${REPEATS:-6}"
ASKS="${ASKS:-512}"
RUN="${RUN:-1}"

# stride 250000 = take a 16 KB rung out of each 250 KB frame (rung delivery)
# stride 16384  = consecutive 16 KB reads (a US stack, or any layout that groups)
STRIDE_SKIP=250000
STRIDE_SEQ=16384

first=1
emit() { # phase label, then read_campaign args
  local label="$1"; shift
  if [[ $first -eq 1 ]]; then
    "$BIN" --study "$BIG" --label "run${RUN}_${label}" --asks "$ASKS" --repeats "$REPEATS" "$@" >> "$OUT"
    first=0
  else
    "$BIN" --study "$BIG" --label "run${RUN}_${label}" --asks "$ASKS" --repeats "$REPEATS" --no-header "$@" >> "$OUT"
  fi
  echo "  done: $label" >&2
}

echo "campaign run $RUN → $OUT" >&2
[[ $RUN -eq 1 ]] && : > "$OUT" || first=0

# A — mechanism × depth × temp, on both access shapes. The main grid.
emit A_stride --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 \
  --temps cold,warm --stride $STRIDE_SKIP --monitors 0
emit A_sweep  --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 \
  --temps cold,warm --stride $STRIDE_SEQ  --monitors 0

# B — does an explicit read-ahead hint compose with the mechanism, or overlap with it?
emit B_prefetch_stride --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 \
  --temps cold --stride $STRIDE_SKIP --monitors 0
emit B_prefetch_sweep  --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 \
  --temps cold --stride $STRIDE_SEQ  --monitors 0

# C — many readers at shallow depth (several sessions) vs one reader at depth.
#     Same total reads in flight, different owners.
emit C_readers --arms pool,uring,hybrid --readers 1,4,16 --depths 1,4 \
  --temps cold --stride $STRIDE_SKIP --monitors 0

# D — ask size, at the two operating points that matter. 16 KB is already phase A.
for sz in 4096 65536 250000; do
  emit "D_size${sz}" --arms pool,hybrid,uring --depths 1,16 --temps cold,warm \
    --size "$sz" --stride $STRIDE_SKIP --monitors 0
done

# E — safety. The monitor is on here and only the gap columns are read: an arm that buys
#     throughput by stalling the executor is invisible in every other column.
emit E_safety --arms pool,uring,hybrid,pooled_pread --depths 1,16 --temps cold,warm \
  --stride $STRIDE_SKIP --monitors 1

echo "campaign run $RUN complete: $(wc -l < "$OUT") rows" >&2
