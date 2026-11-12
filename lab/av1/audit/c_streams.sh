#!/usr/bin/env bash
# Protocol C's streams (docs/av1/audit-protocols.md §C amendment 1): each volume's exact series and its OQ form at
# Q 8 and at the rule's Q, G 1, as frame files (NNN.htj2k, NNN.av1) with their metadata, coded by the demo tip.
#
#   TIP=<demo tip worktree> OUT=<dir> lab/av1/audit/c_streams.sh
set -euo pipefail
: "${TIP:?}" "${OUT:?}"
BUILD="${BUILD:-$TIP/ingest/.build}"
DATA="${DATA:-$TIP/lab/av1/data}"
PY="${PY:-$TIP/lab/av1/.venv/bin/python}"
# volume  rule Q (B0's integer pick under the pooled x*, rows/b0.json)  depth cut
STREAMS=("dbts_a1 6 --depth-cut" "dbts_b1 11 " "dbts_c1 7 --depth-cut")

[[ -x "$BUILD/aom-3.15.1/bin/aomenc" && -f "$BUILD/payload/libdecode.so" ]] || BUILD="$BUILD" "$TIP/ingest/tools.sh"
[[ -x "$PY" ]] || { python3.11 -m venv "$TIP/lab/av1/.venv" && "$TIP/lab/av1/.venv/bin/pip" install -q --require-hashes -r "$TIP/lab/av1/requirements.txt"; }
OUT="$DATA" "$TIP/lab/av1/fetch_data.sh" dbts_a1 dbts_b1 dbts_c1
mkdir -p "$OUT"
code() {  # SET ID [options]
  local set=$1 id=$2
  shift 2
  [[ -f "$OUT/$id/metadata.json" ]] && return
  rm -rf "$OUT/$id"
  "$PY" "$TIP/lab/av1/tools/ingest_coded.py" "$BUILD" "$DATA/$set" "$OUT/$id" --jobs "$(nproc)" "$@" >/dev/null
}
for s in "${STREAMS[@]}"; do
  read -r set rule cut <<<"$s"
  code "$set" "$set" --codec htj2k
  for q in 8 "$rule"; do code "$set" "$set-q$q-g1" --lossy "$q" 1 --exact-series "$set" $cut; done
done
ls "$OUT"
