#!/usr/bin/env bash
# Fetches every source of docs/transport/link-conditions.md into $1 and checks it against SHA256SUMS.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: fetch.sh <empty dir>}
mkdir -p "$out"
while IFS=$'\t' read -r name url; do
  [ -f "$out/$name" ] || curl -fsSL -A 'Mozilla/5.0' -o "$out/$name" "$url"
done < "$here/sources.tsv"
# Ookla re-aggregates tiles for data-subject requests, so a parquet may drift from its sum.
(cd "$out" && sha256sum -c "$here/SHA256SUMS")
