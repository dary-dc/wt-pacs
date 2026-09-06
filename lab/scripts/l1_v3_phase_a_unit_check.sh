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

echo "== tail gate refuses to soften (B1) =="
# 60 misses cannot support a 5-sample tail: exit 3, stamped, never silently ok.
thin="$ROOT/docs/measurements/r2/raw/l1v3/small/S_rtt60_loss0_d4_r1.json"
set +e; line="$(l1_tail_gate "$thin")"; trc=$?; set -e
echo "thin=$line exit=$trc"
[[ $trc -eq 3 ]] && grep -q 'p95_unsupported' <<<"$line"
thick="$ROOT/docs/measurements/r2/raw/l1v3/small/S_rtt60_loss2_d4_r1.json"
set +e; line="$(l1_tail_gate "$thick")"; trc=$?; set -e
echo "thick=$line exit=$trc"
[[ $trc -eq 0 ]]

echo "== null gate is an interval, not a tolerance (B2) =="
# Phase C's own null cell cannot exclude a 15% arm gap at n=10.
set +e; l1_null_gate "$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv" 15; trc=$?; set -e
echo "null_gate_exit=$trc"
[[ $trc -eq 3 ]]
# A wide bar the same cell can clear, so the gate is not simply always-fail.
set +e; l1_null_gate "$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv" 500 >/dev/null; trc=$?; set -e
echo "null_gate_wide_bar_exit=$trc"
[[ $trc -eq 0 ]]

echo "== directional header will not truncate tracked results (B4) =="
set +e
l1_write_directional_header "$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv" 2>/dev/null
trc=$?
set -e
echo "overwrite_guard_exit=$trc"
[[ $trc -ne 0 ]]
[[ "$(grep -vc '^#' "$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv")" -eq 81 ]]

echo "== precheck ratio (clinical 33ms @ 10Mbps/32k) =="
l1_precheck_ratio 33 "unit_null"

echo "== protocol sha =="
l1_protocol_sha >/dev/null

echo "ALL_UNIT_CHECKS_OK"
