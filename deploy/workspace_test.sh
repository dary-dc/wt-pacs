#!/bin/sh
# The image's workspace stage copies every workspace member's manifest, or its `cargo build` cannot load the workspace.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failed=0
for m in $(sed -n '/^members/,/]/p' "$ROOT/Cargo.toml" | grep -oE '"[^"]+"' | tr -d '"'); do
  if awk -v m="$m" '/^FROM / { stage = $NF } stage == "workspace" && /^COPY / {
        for (i = 2; i < NF; i++) { s = $i; sub(/\/$/, "", s)
          if (s == m || index(m, s "/") == 1 || s == m "/Cargo.toml") found = 1 } }
      END { exit !found }' "$ROOT/deploy/Containerfile"; then
    echo "ok: the workspace stage copies $m"
  else
    echo "FAIL: deploy/Containerfile's workspace stage does not copy $m"; failed=1
  fi
done
exit $failed
