#!/usr/bin/env bash
# L1 v3 Phase C — small directional collect (scaffolding).
#
# Refuses unless ALL of:
#   APPROVE_SMALL_COLLECT=1
#   docs/lanes/L1-v3-phase-b-regime-reader.md exists
#   cadence JSON carries reader_model
#
# TSV stamped DIRECTIONAL — NOT A DECISION. Full SSH body stays gated.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/l1_v3_common.sh"

COMPLETE_PLAN="$ROOT/docs/lanes/L1-v3-complete-plan.md"
PHASE_B_DOC="$ROOT/docs/lanes/L1-v3-phase-b-regime-reader.md"
CADENCE_JSON="${CADENCE_JSON:-$ROOT/docs/measurements/r2/l1_v3_cadence.json}"
PATH_TSV="${PATH_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"
OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv}"
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3/small}"
REPEATS_NULL="${REPEATS_NULL:-10}"

if [[ "${APPROVE_SMALL_COLLECT:-0}" != "1" ]]; then
  echo "STOP: small collect not approved." >&2
  echo "  Set APPROVE_SMALL_COLLECT=1 only after Phases A–B sign-off." >&2
  echo "  See $COMPLETE_PLAN" >&2
  exit 3
fi

[[ -f "$COMPLETE_PLAN" ]] || { echo "STOP: missing $COMPLETE_PLAN" >&2; exit 4; }
[[ -f "$PHASE_B_DOC" ]] || { echo "STOP: Phase B note missing ($PHASE_B_DOC)." >&2; exit 4; }
[[ -f "$PATH_TSV" ]] || { echo "STOP: missing path validation $PATH_TSV" >&2; exit 4; }
[[ -f "$CADENCE_JSON" ]] || { echo "STOP: missing cadence $CADENCE_JSON" >&2; exit 4; }

python3 - "$CADENCE_JSON" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
rm = doc.get("reader_model") or {}
if not rm.get("name"):
    raise SystemExit("STOP: cadence JSON missing reader_model.name (Phase B incomplete)")
st = doc.get("status") or ""
if st not in ("frozen_for_review", "frozen_phase_b", "frozen"):
    raise SystemExit(f"STOP: cadence status={st!r} not frozen")
print(f"cadence_ok reader_model={rm['name']} factor={rm.get('factor')}")
PY

l1_require_study_trace
PROTOCOL_SHA="$(l1_protocol_sha)"
CADENCE_SHA="$(l1_cadence_sha "$CADENCE_JSON")"

mkdir -p "$RAW_DIR" "$(dirname "$OUT_TSV")"
l1_write_directional_header "$OUT_TSV"

echo "=== L1 v3 small collect (DIRECTIONAL) $(date -Iseconds) ==="
echo "fixture_fc=$L1_FIX_FC study=$(basename "$L1_STUDY") trace=$(basename "$L1_TRACE")"
echo "protocol_sha=$PROTOCOL_SHA cadence_sha=$CADENCE_SHA"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN=1 — validate A-gates locally; no SSH collect body."
  echo "-- interleaved schedule (first 12) --"
  L1_INTERLEAVE_SEED=1 l1_interleave_arms "$REPEATS_NULL" S P Q | head -12
  step="$(python3 -c "import json;d=json.load(open('$CADENCE_JSON'));print(next(c['step_interval_ms'] for c in d['cells'] if c['rtt_label_ms']==60 and float(c['loss_pct'])==0))")"
  echo "precheck null cell step_ms=$step"
  l1_precheck_ratio "$step" "dry_null_60_0"
  sample="$(ls "$ROOT"/docs/measurements/r2/raw/l1v3/pilot/S_rtt60_loss0_d4_r*.json | head -1)"
  echo "sample=$sample"
  l1_assert_frame_bytes "$sample"
  echo -n "regime="; l1_stamp_regime "$sample" 0
  set +e
  tail_line="$(l1_tail_gate "$sample" 2>/dev/null)"
  trc=$?
  set -e
  echo "tail_gate_line=$tail_line exit=$trc (80-frame pilots may FAIL L1_TAIL_MIN=$L1_TAIL_MIN — expected)"
  echo "header:"; head -2 "$OUT_TSV"
  echo "DRY_RUN complete."
  exit 0
fi

echo "STOP: full small-collect SSH body not enabled in this commit." >&2
echo "  A-gates + interleave + directional header landed." >&2
echo "  Self-test: DRY_RUN=1 APPROVE_SMALL_COLLECT=1 bash $0" >&2
exit 3
