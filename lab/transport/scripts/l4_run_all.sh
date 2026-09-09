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
  bash lab/transport/scripts/l4_campaign.sh "$R"
}

# E3 — stream shape under loss. The question three campaigns have failed to answer.
e3() {
  EXP=e3 CELLS="A B C" FIXTURE=frames_32k DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e3.tsv" \
  ARMS="shared|--stream-mode shared --congestion cubic;\
perframe|--stream-mode per-frame --congestion cubic;\
perframe_fifo|--stream-mode per-frame --congestion cubic --send-fairness false" \
  bash lab/transport/scripts/l4_campaign.sh "$R"
}

# E5 — frame size. Tests whether p95 tracks the ramp (spec S2) or the link.
e5() {
  for FX in frames_32k frames_250k; do
    EXP=e5 CELLS="A B" FIXTURE="$FX" DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e5.tsv" \
    ARMS="cubic_iw12k|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;\
cubic_iw240k|ENV:QUINN_INITIAL_WINDOW=240000 --stream-mode shared --congestion cubic" \
    bash lab/transport/scripts/l4_campaign.sh "$R"
  done
}

# E4 — negative control. The GSO segment cap is a syscall-batching lever; these cells are
# RTT-bound, so it must show NO effect. If it does, the rig is measuring something else.
e4() {
  for SEG in 10 32; do
    EXP=e4 CELLS="A B" FIXTURE=frames_32k DEPTH=4 TRACE="$TRACE" OUT="$OUTDIR/e4.tsv" \
    SRV_BIN="$ROOT/target/lab-arms/exact-server-seg$SEG" \
    ARMS="seg$SEG|--stream-mode shared --congestion cubic" \
    bash lab/transport/scripts/l4_campaign.sh "$R"
  done
}

# R-series: jump-bearing trace, fixed harness, per-row verdicts, nz_p95. Everything before it
# is superseded.
JUMP="$ROOT/lab/traces/radiologist_review_500.json"
FIX="${FIX:-frames_500x64k}"          # 500 frames; 80 caches entirely in seconds
export CACHE_FRAMES="${CACHE_FRAMES:-64}"   # ~4 MB, a plausible tablet budget

# R1 — controller, in the deployment's own regime. Cubic cannot congest a 1%-loss
# wireless link (Mathis: 14% of 5G, 3% of satellite), so this is the operating point.
r1() {
  EXP=r1 CELLS="W S L H" FIXTURE="$FIX" DEPTH=8 TRACE="$JUMP" LOSS_BURST=5   OUT="$OUTDIR/r1_controller.tsv"   ARMS="cubic|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;bbr|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion bbr"   bash lab/transport/scripts/l4_campaign.sh "$R"
}

# R2 — stream shape, with jumps and with the transport on the critical path.
r2() {
  EXP=r2 CELLS="W S" FIXTURE="$FIX" DEPTH=8 TRACE="$JUMP" LOSS_BURST=5   OUT="$OUTDIR/r2_stream_shape.tsv"   ARMS="shared|--stream-mode shared --congestion cubic;perframe|--stream-mode per-frame --congestion cubic;perframe_fifo|--stream-mode per-frame --congestion cubic --send-fairness false"   bash lab/transport/scripts/l4_campaign.sh "$R"
}

# R3 — stream shape under BBR, the only controller that completes at satellite RTT. R2 ran
# the shapes under Cubic and every cell-S row voided, leaving the high-RTT case unmeasured.
r3() {
  EXP=r3 CELLS="W S" FIXTURE="$FIX" DEPTH=8 TRACE="$JUMP" LOSS_BURST=5 RUN_TIMEOUT=600 \
  OUT="$OUTDIR/r3_shape_x_controller.tsv" \
  ARMS="shared_bbr|--stream-mode shared --congestion bbr;perframe_bbr|--stream-mode per-frame --congestion bbr;perframe_fifo_bbr|--stream-mode per-frame --congestion bbr --send-fairness false" \
  bash lab/transport/scripts/l4_campaign.sh "$R"
}

# R4 — how long does Cubic ACTUALLY need at satellite RTT? R1/R2 established only
# "more than 180 s". A number is worth more than a timeout.
r4() {
  EXP=r4 CELLS="S" FIXTURE="$FIX" DEPTH=8 TRACE="$JUMP" LOSS_BURST=5 RUN_TIMEOUT=900 \
  OUT="$OUTDIR/r4_cubic_satellite.tsv" \
  ARMS="cubic|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;bbr|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion bbr" \
  bash lab/transport/scripts/l4_campaign.sh "$R"
}

# R5 — the same two controllers in both loss regimes, with the fixed harness. R5a congestive:
# 0% loss, depth 16. R5b exogenous: 1% loss, depth 8. Assert qdrop > 0 in R5a and 0 in R5b.
r5a() {
  EXP=r5a CELLS="Wc Sc" FIXTURE="$FIX" DEPTH=16 TRACE="$JUMP" LOSS_BURST=1 RUN_TIMEOUT=900 \
  OUT="$OUTDIR/r5a_congestive.tsv" \
  ARMS="cubic|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;bbr|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion bbr" \
  bash lab/transport/scripts/l4_campaign.sh "$R"
}
r5b() {
  EXP=r5b CELLS="W S" FIXTURE="$FIX" DEPTH=8 TRACE="$JUMP" LOSS_BURST=5 RUN_TIMEOUT=900 \
  OUT="$OUTDIR/r5b_exogenous.tsv" \
  ARMS="cubic|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion cubic;bbr|ENV:QUINN_INITIAL_WINDOW=12000 --stream-mode shared --congestion bbr" \
  bash lab/transport/scripts/l4_campaign.sh "$R"
}

for e in "$@"; do "$e"; done
