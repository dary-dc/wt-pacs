#!/usr/bin/env bash
# What a client that asks for everything and stops reading costs the server.
# `docs/transport/transport-conclusions.md` §Flow-control windows — the 180 kB property.
#
#   lab/scripts/stall_memory_cell.sh <label> <server-bin> [<label> <server-bin> ...]
#
# Peak RssAnon over the hold, minus the server's settled baseline before the client connects.
# The frame pool hands quinn the reader's own buffer, so a peer that never acknowledges pins
# it: this is the cell that says whether the ceiling moved.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

STUDY="${STUDY:-lab/fixtures/frames_250k/frames_250k.sbnd}"
FRAMES="${FRAMES:-80}"
ASKS="${ASKS:-300}"
AFTER_MS="${AFTER_MS:-1500}"
HOLD_MS="${HOLD_MS:-12000}"
HARNESS="${HARNESS:-target/release/window-harness}"

rss_kib() { awk '/^RssAnon:/ {print $2}' "/proc/$1/status" 2>/dev/null || echo 0; }

while [[ $# -gt 0 ]]; do
  label=$1; bin=$2; shift 2
  port=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log=$(mktemp)
  NO_COLOR=1 RUST_LOG=exact_server=warn "$bin" --port "$port" --study "$STUDY" \
    --bind 127.0.0.1 --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem \
    >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 100); do grep -q '^wt_url=' "$log" && break; sleep 0.1; done
  sleep 1
  base=$(rss_kib "$pid")

  "$HARNESS" --url "https://127.0.0.1:$port/" --mode stall --bind 127.0.0.1 \
    --frame-count "$FRAMES" --stall-asks "$ASKS" --stall-after-ms "$AFTER_MS" \
    --stall-hold-ms "$HOLD_MS" >/dev/null 2>&1 &
  client=$!

  peak=$base
  while kill -0 "$client" 2>/dev/null; do
    cur=$(rss_kib "$pid")
    [[ "$cur" -gt "$peak" ]] && peak=$cur
    sleep 0.2
  done
  wait "$client" 2>/dev/null || true
  printf '%-14s baseline %6s KiB   peak %6s KiB   held %6s KiB\n' \
    "$label" "$base" "$peak" "$((peak - base))"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
done
