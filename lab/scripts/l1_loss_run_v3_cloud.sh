#!/usr/bin/env bash
# L1 v3 campaign entrypoint.
#   PHASE=path    → path validation (S4a/S4b/S5)
#   PHASE=pilot   → A1 cadence pilots → l1_v3_cadence.json
#   PHASE=collect → refused until small-collect plan is approved + implemented
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PHASE="${PHASE:-path}"

case "$PHASE" in
  path)
    exec bash "$ROOT/lab/scripts/l1_v3_path_validate.sh" "$@"
    ;;
  pilot)
    exec bash "$ROOT/lab/scripts/l1_v3_pilot_cadence.sh" "$@"
    ;;
  collect)
    PATH_TSV="${PATH_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"
    CADENCE="${CADENCE:-$ROOT/docs/measurements/r2/l1_v3_cadence.json}"
    PLAN="$ROOT/docs/lanes/L1-v3-small-collect-plan.md"
    [[ -f "$PATH_TSV" ]] || {
      echo "STOP: missing path validation ($PATH_TSV)" >&2
      exit 4
    }
    [[ -f "$CADENCE" ]] || {
      echo "STOP: missing frozen cadence ($CADENCE). Run PHASE=pilot first." >&2
      exit 4
    }
    echo "STOP: PHASE=collect is gated on reviewer approval of:" >&2
    echo "  $PLAN" >&2
    echo "Small collect is not auto-started (avoid unreliable long runs)." >&2
    echo "Cadence artifact OK: $CADENCE" >&2
    exit 3
    ;;
  *)
    echo "PHASE must be path|pilot|collect (got: $PHASE)" >&2
    exit 2
    ;;
esac
