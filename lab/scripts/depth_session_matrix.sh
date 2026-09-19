#!/usr/bin/env bash
# This tree against `main` across the depth x sessions plane, one interleaved A/B per cell.
# `docs/transport/why-these-changes.md` §9. Depth divides throughput into latency, so both
# columns are printed per cell and the house rule picks which one the cell is allowed to claim:
# one session is a latency cell, many sessions at depth is a throughput cell.
#
#   BASE=<bin> TREE=<bin> lab/scripts/depth_session_matrix.sh > matrix.tsv
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

BASE="${BASE:-/tmp/base-target/release/exact-server}"
TREE="${TREE:-target/release/exact-server}"
REPS="${REPS:-6}"
DEPTHS="${DEPTHS:-1 2 4 8}"
SESSIONS="${SESSIONS:-1 4 16}"
tmp=$(mktemp -d)

printf 'frame\tdepth\tsessions\td_asks_per_s\tpaired\td_p50\tpaired\td_cpu_per_ask\tpaired\n'

for fx in 32k 250k; do
  study="lab/fixtures/frames_${fx}/frames_${fx}.sbnd"
  for sessions in $SESSIONS; do
    case "$fx:$sessions" in
      32k:1) asks=400 ;; 32k:4) asks=300 ;; 32k:16) asks=200 ;;
      250k:1) asks=200 ;; 250k:4) asks=150 ;; 250k:16) asks=100 ;;
      *) asks=100 ;;
    esac
    for depth in $DEPTHS; do
      out="$tmp/$fx-$depth-$sessions.tsv"
      SERVER_CPUS="${SERVER_CPUS:-0,1}" CLIENT_CPUS="${CLIENT_CPUS:-2,3}" \
        lab/scripts/runtime_ab.sh "$study" on-demand "$depth" "$asks" "$sessions" "$REPS" \
        base "$BASE" -- tree "$TREE" >"$out" 2>/dev/null
      lab/scripts/runtime_ab_pair.py "$out" base tree 2>/dev/null \
        | awk -v f="$fx" -v d="$depth" -v s="$sessions" '
          /^asks_per_s/ { a=$4; ap=$5 }
          /^p50_us/     { p=$4; pp=$5 }
          /^cpu_us_per_ask/ { c=$4; cp=$5 }
          END { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", f, d, s, a, ap, p, pp, c, cp }'
    done
  done
done
rm -rf "$tmp"
