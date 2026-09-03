#!/usr/bin/env bash
# L1 v3 campaign entrypoint.
#   PHASE=path   → l1_v3_path_validate.sh (S4a/S4b/S5)  [default]
#   PHASE=pilot  → cadence pilots (requires path gates)
#   PHASE=collect → full interleaved campaign
#
# Pilot/collect share helpers with path validation; both processes run ON the rig.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PHASE="${PHASE:-path}"

case "$PHASE" in
  path)
    exec bash "$ROOT/lab/scripts/l1_v3_path_validate.sh" "$@"
    ;;
  pilot|collect)
    ;;
  *)
    echo "PHASE must be path|pilot|collect (got: $PHASE)" >&2
    exit 2
    ;;
esac

# Pilot/collect are gated on a successful path validation artifact.
PATH_TSV="${PATH_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"
if [[ ! -f "$PATH_TSV" ]]; then
  echo "STOP: missing path validation TSV ($PATH_TSV)." >&2
  echo "Run: PHASE=path bash lab/scripts/l1_loss_run_v3_cloud.sh" >&2
  exit 4
fi

echo "=== L1 v3 PHASE=$PHASE ===" >&2
echo "Path gates artifact present: $PATH_TSV" >&2
echo "Pilot/collect orchestration is staged next; path validation is the hard gate." >&2
echo "Re-run PHASE=path after any harness/server/netem change." >&2
exit 0
