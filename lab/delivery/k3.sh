#!/usr/bin/env bash
# K3: claude/transport-arms' WT-TS arm alone (today's downloader, no decode) on dbts_b1's exact series at each form's
# two prefixes, four visits each, interleaved; rows to OUT/K3-<CELL>.jsonl for inputs.mjs.
# docs/client/evidence/delivery-comparison.md §4.2; lab/delivery/README.md
#
#   lab/delivery/k3.sh SERIES_DIR OUT [CELL …]      SERIES_DIR as series.sh wrote it; default every cell
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
shift 2
CELLS=("${@:-CLEAN PUB LTE LOSS CR}")
read -ra CELLS <<<"${CELLS[*]}"
REV=9fad9d9bf  # the transport rig the protocol names (§2)
EXACT="${EXACT:-dbts_b1}"
W="$ROOT/lab/delivery/.transport-arms"
[[ -d $W ]] || git -C "$ROOT" worktree add -q --detach "$W" "$REV"
[[ "$(git -C "$W" rev-parse --short=9 HEAD)" == "$REV" ]] || { echo "$W is not $REV" >&2; exit 2; }
# Built here: run.mjs re-runs itself in a network namespace, where cargo and npm reach nothing.
(cd "$W" && cargo build -q --release -p series-server --features lab-get && bash lab/transport-arms/build.sh >/dev/null)
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

form() {  # N: a series directory as run.mjs reads it, the first N frames of $EXACT
  local id=$EXACT
  [[ -f "$DIR/$EXACT-p$1.sbnd" ]] && id=$EXACT-p$1
  mkdir -p "$T/p$1"
  ln -sf "$DIR/$id.sbnd" "$T/p$1/series.sbnd"
  ln -sf "$DIR/$id.metadata.json" "$T/p$1/metadata.json"
  echo "$T/p$1"
}
for cell in "${CELLS[@]}"; do
  read -r n1 n2 < <(node -e "import('$ROOT/lab/delivery/plan.mjs').then((p) => console.log(p.CELLS['$cell'].k3.join(' ')))")
  for visit in 1 2 3 4; do
    for n in "$n1" "$n2"; do
      (cd "$W" && node lab/transport-arms/run.mjs --cell "$cell" --arms WT-TS --server "$W/target/release/series-server" --rounds 1 --series "$(form "$n")" \
        --lte-frames "$n" --loss-frames "$n" --out "$OUT/K3-$cell.jsonl") | grep -v "^$" | tail -2
    done
  done
done
