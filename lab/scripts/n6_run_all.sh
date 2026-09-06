#!/usr/bin/env bash
# The N6 campaign: WASM vs TypeScript client on one wire.
#
#   scripts/gate.sh --quick            # the tree is sound before anything is measured
#   lab/scripts/link_shim_check.py     # the shaped link is the link it claims to be
#   lab/scripts/n6_run_all.sh          # this
#   lab/scripts/n6_analyze.py --all
#
# Cells run cheapest-first so a break shows up early. Every cell is interleaved and
# order-alternated by the driver; the A/A cell runs first and sets the noise floor that any
# A/B claim in this campaign has to clear.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUN="python3 lab/scripts/n6_campaign.py"
K250="lab/fixtures/frames_250k/frames_250k.sbnd"
K32="lab/fixtures/frames_32k/frames_32k.sbnd"

# --- A/A: the apparatus measured against itself -----------------------------------------
$RUN --cell-id aa-local-250k-ondemand --arms ts,ts \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 400 --interval-ms 20 --repeats 6

# --- Unshaped loopback: maximum sensitivity to the runtime term ---------------------------
$RUN --cell-id local-250k-ondemand \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 400 --interval-ms 20 --repeats 6
$RUN --cell-id local-32k-ondemand \
     --study "$K32" --frames 80 --ask-cell ondemand --depth 1 --n 400 --interval-ms 10 --repeats 6
$RUN --cell-id local-250k-fill \
     --study "$K250" --frames 80 --ask-cell fill --n 80 --repeats 6
$RUN --cell-id local-250k-ondemand-shared --stream-mode shared \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 400 --interval-ms 20 --repeats 6

# --- Shaped link: does the runtime term still matter to a reader? -------------------------
$RUN --cell-id shaped60-250k-ondemand --link shim --delay-ms 30 --rate-mbit 10 \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 80 --interval-ms 350 --repeats 5
$RUN --cell-id shaped60-250k-fill --link shim --delay-ms 30 --rate-mbit 10 \
     --study "$K250" --frames 80 --ask-cell fill --n 80 --repeats 5
$RUN --cell-id shaped20-250k-ondemand --link shim --delay-ms 10 --rate-mbit 10 \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 80 --interval-ms 300 --repeats 4
$RUN --cell-id shaped150-250k-ondemand --link shim --delay-ms 75 --rate-mbit 10 \
     --study "$K250" --frames 80 --ask-cell ondemand --depth 1 --n 80 --interval-ms 420 --repeats 4

echo "campaign done"
