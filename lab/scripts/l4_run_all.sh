#!/usr/bin/env bash
# L4 — the whole campaign, in the order the pre-registration fixes.
# Each experiment writes its own TSV under .local/measurements/l4/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
R="${REPEATS:-3}"
TRACE="$ROOT/lab/traces/cine_scrub_30fps.json"
OUTDIR="$ROOT/.local/measurements/l4"; mkdir -p "$OUTDIR"

# E12 — initial window × congestion controller (breaks the confound: BBR ships a 20x window)
e12() {
  EXP=e12 CELLS="A B C" FIXTURE=frames_32k DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e12.tsv" \
  ARMS="cubic_iw12k|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;\
cubic_iw48k|ENV:QUINN_INITIAL_WINDOW=48000 --stream-mode shared --congestion cubic;\
cubic_iw240k|ENV:QUINN_INITIAL_WINDOW=240000 --stream-mode shared --congestion cubic;\
bbr_iw12k|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion bbr;\
bbr_iw240k|ENV:QUINN_INITIAL_WINDOW=240000 --stream-mode shared --congestion bbr" \
  bash lab/scripts/l4_campaign.sh "$R"
}

# E3 — stream shape under loss. The question three campaigns have failed to answer.
e3() {
  EXP=e3 CELLS="A B C" FIXTURE=frames_32k DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e3.tsv" \
  ARMS="shared|--stream-mode shared --congestion cubic;\
perframe|--stream-mode per-frame --congestion cubic;\
perframe_fifo|--stream-mode per-frame --congestion cubic --send-fairness false" \
  bash lab/scripts/l4_campaign.sh "$R"
}

# E5 — frame size. Tests whether p95 tracks the ramp (spec S2) or the link.
e5() {
  for FX in frames_32k frames_250k; do
    EXP=e5 CELLS="A B" FIXTURE="$FX" DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e5.tsv" \
    ARMS="cubic_iw12k|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;\
cubic_iw240k|ENV:QUINN_INITIAL_WINDOW=240000 --stream-mode shared --congestion cubic" \
    bash lab/scripts/l4_campaign.sh "$R"
  done
}

# E4 — negative control. The GSO segment cap is a syscall-batching lever; these cells are
# RTT-bound, so it must show NO effect. If it does, the rig is measuring something else.
e4() {
  for SEG in 10 32; do
    EXP=e4 CELLS="A B" FIXTURE=frames_32k DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e4.tsv" \
    SRV_BIN="$ROOT/target/lab-arms/exact-server-seg$SEG" \
    ARMS="seg$SEG|--stream-mode shared --congestion cubic" \
    bash lab/scripts/l4_campaign.sh "$R"
  done
}

for e in "$@"; do "$e"; done
