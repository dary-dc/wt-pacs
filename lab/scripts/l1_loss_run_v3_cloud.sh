#!/usr/bin/env bash
# L1 v3 campaign entrypoint.
#   PHASE=path     → path validation (S4a/S4b/S5)
#   PHASE=pilot    → A1 cadence pilots → l1_v3_cadence.json
#   PHASE=collect  → small directional collect (gated; see complete plan Phases A–C)
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
    # Phase C directional collect; refuses without APPROVE_SMALL_COLLECT=1.
    exec bash "$ROOT/lab/scripts/l1_v3_collect_small.sh" "$@"
    ;;
  *)
    echo "PHASE must be path|pilot|collect (got: $PHASE)" >&2
    exit 2
    ;;
esac
