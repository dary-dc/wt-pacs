#!/usr/bin/env bash
# Local unit checks for L1 v3 Phase A helpers (no SSH).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/l1_v3_common.sh"

echo "== fixture defaults =="
l1_require_study_trace
echo "L1_FIX_FC=$L1_FIX_FC study=$(basename "$L1_STUDY") trace=$(basename "$L1_TRACE")"
[[ "$L1_FIX_FC" == "160" ]]
[[ -f "$L1_STUDY" && -f "$L1_TRACE" ]]

echo "== interleave =="
mapfile -t sched < <(L1_INTERLEAVE_SEED=42 l1_interleave_arms 3 S P Q)
echo "n=${#sched[@]} ${sched[*]}"
[[ ${#sched[@]} -eq 9 ]]

echo "== directional header =="
tmp="$(mktemp)"
l1_write_directional_header "$tmp"
head -2 "$tmp"
grep -q 'DIRECTIONAL — NOT A DECISION' "$tmp"

echo "== frame bytes + regime + tail on pilot sample =="
sample="$(ls "$ROOT"/docs/measurements/r2/raw/l1v3/pilot/S_rtt60_loss0_d4_r*.json | head -1)"
l1_assert_frame_bytes "$sample"
echo -n "regime_clean="; l1_stamp_regime "$sample" 0
slow="$(ls "$ROOT"/docs/measurements/r2/raw/l1v3/pilot/S_rtt60_loss2_d4_r1.json)"
echo -n "regime_slow="; l1_stamp_regime "$slow" 2
set +e
l1_tail_gate "$sample"
trc=$?
set -e
echo "tail_gate_exit=$trc"

echo "== precheck ratio (clinical 33ms @ 10Mbps/32k) =="
l1_precheck_ratio 33 "unit_null"

echo "== protocol sha =="
l1_protocol_sha >/dev/null

echo "ALL_UNIT_CHECKS_OK"
