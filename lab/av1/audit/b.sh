#!/usr/bin/env bash
# Protocol B's shared cells (docs/av1/audit-protocols.md §B amendment 1), in the amendment's volume order; rerun to
# resume, as finished cells are skipped. MUTATE=1 runs only the check's --cpu-used=5 encode.
#
#   GROUPS_DIR=<0e0e58c8>/lab/av1/groups BUILD=... DATA=... WORK=... PY=... lab/av1/audit/b.sh [G ...]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SETS="dbts_a1 dbts_b1 dbts_c1 dbt12_c dbts_a2 dbts_b2 dbts_c2 dbt12_ea1141 dbts_a3 dbts_b3 dbts_c3 dbt10_d dbts_a4
      dbts_b4 dbts_c4 dbt10_ea1141 dbts_a5 dbts_b5 dbts_c5"
export LD_LIBRARY_PATH="$BUILD/dav1d/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$HERE/rows" "$WORK"
# shellcheck disable=SC2046,SC2086
exec "$PY" "$HERE/cells.py" "$BUILD" "$WORK" "$HERE/rows/b.jsonl" $(printf "$DATA/%s " $SETS) --g ${*:-1 16} \
  ${MUTATE:+--mutate}
