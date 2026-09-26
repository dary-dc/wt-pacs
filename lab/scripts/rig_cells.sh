#!/usr/bin/env bash
# The shaped cells docs/transport/transport-conclusions.md asks the rig for, run ON the rig inside one network
# namespace: netem on lo shapes both directions, server and driver share the box, and
# runtime_ab.sh reads CPU per ask and the client's dropped datagrams as on loopback.
#
#   unshare --user --map-root-user --net -- lab/scripts/rig_cells.sh <cell> <out.tsv> <label> <bin> [-- <label> <bin>]...
#
#   cell   segs      250 KB, depth 4, 8 sessions — the segment cap (docs/transport/transport-conclusions.md §9); pass seg44 and seg10 binaries
#          cc        250 KB, depth 4, 8 sessions — the controller (item 2); one binary, arms cubic and bbr
#          q         250 KB, depth 4, 1 session — per-frame + priority against shared (item 3); one binary
#   RATE_MBIT (20), RTT_MS (50), LOSS_PCT (0), LOSS_MODEL (iid | gemodel), REPS (6) shape the link and the count.
#   Binaries are built elsewhere and copied in: the rig is 2 cores and cannot build. Untested from the agent
#   container, which has no sch_netem; the shape is stream_mode_x3_only.sh's.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cell=$1; out=$2; shift 2
RATE_MBIT=${RATE_MBIT:-20}; RTT_MS=${RTT_MS:-50}; LOSS_PCT=${LOSS_PCT:-0}; LOSS_MODEL=${LOSS_MODEL:-iid}; REPS=${REPS:-6}
FX=${FX:-$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd}
ip link set lo up
one_way=$(python3 -c "print(max(0.001, $RTT_MS / 2))")
loss=()
case "$LOSS_MODEL" in
  iid) [[ "$LOSS_PCT" != 0 ]] && loss=(loss "${LOSS_PCT}%") ;;
  gemodel) loss=(loss gemodel "${GE_P:-0.07}%" "${GE_R:-14}%") ;;
  *) echo "LOSS_MODEL iid|gemodel" >&2; exit 2 ;;
esac
tc qdisc replace dev lo root netem delay "${one_way}ms" rate "${RATE_MBIT}mbit" "${loss[@]}"
tc qdisc show dev lo >&2
case "$cell" in
  segs) "$ROOT/lab/scripts/runtime_ab.sh" "$FX" on-demand 4 100 8 "$REPS" "$@" ;;
  cc)   bin=$2; "$ROOT/lab/scripts/runtime_ab.sh" "$FX" on-demand 4 100 8 "$REPS" cubic "$bin" --congestion cubic -- bbr "$bin" --congestion bbr ;;
  q)    bin=$2; "$ROOT/lab/scripts/runtime_ab.sh" "$FX" on-demand 4 200 1 "$REPS" shared "$bin" -- q "$bin" --stream-mode per-frame ;;
  *) echo "cell segs|cc|q" >&2; exit 2 ;;
esac > "$out"
tc qdisc del dev lo root 2>/dev/null || true
echo "rows: $(($(wc -l < "$out") - 1)) → $out" >&2
