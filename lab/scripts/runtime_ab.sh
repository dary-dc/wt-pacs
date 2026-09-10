#!/usr/bin/env bash
# Interleaved A/B of two server binaries on one warm cell, both servers up for the whole run,
# arm order reversed every repeat. `docs/transport/why-these-changes.md` §8.
#
#   lab/scripts/runtime_ab.sh <fixture> <on-demand|fill> <depth> <asks> <sessions> <repeats> \
#     <label-a> <bin-a> [server args...] -- <label-b> <bin-b> [server args...] [-- ...]
#
# One row per run, `server_ab`'s columns plus the server's context switches per ask.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fx=$1; mode=$2; depth=$3; asks=$4; sessions=$5; reps=$6; shift 6
arms=(); bins=(); args=()
while [[ $# -gt 0 ]]; do
  arms+=("$1"); bins+=("$2"); shift 2; a=""
  while [[ $# -gt 0 && "$1" != "--" ]]; do a="$a $1"; shift; done
  args+=("$a"); [[ $# -gt 0 ]] && shift
done
pids=(); ports=(); logs=()
for i in "${!arms[@]}"; do
  port=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log=$(mktemp)
  # shellcheck disable=SC2086
  NO_COLOR=1 RUST_LOG=exact_server=warn "${bins[$i]}" --port "$port" --study "$fx" --stream-mode shared \
    --bind 127.0.0.1 --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    ${args[$i]} >"$log" 2>&1 &
  pids+=($!); ports+=("$port"); logs+=("$log")
done
trap 'kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null; rm -f "${logs[@]}"' EXIT
for log in "${logs[@]}"; do
  for _ in $(seq 1 200); do grep -q '^telemetry=' "$log" && break; sleep 0.05; done
done
frames=$(sed -n 's/^frames=//p' "${logs[0]}" | head -1)
ctx() { awk '/ctxt_switches/ {s+=$2} END {print s+0}' "/proc/$1/task/"*/status; }
run() {
  local i=$1 r=$2 c0 c1 row
  c0=$(ctx "${pids[$i]}")
  row=$("$ROOT/target/release/server_ab" --url "https://127.0.0.1:${ports[$i]}/" --server-pid "${pids[$i]}" \
    --mode "$mode" --depth "$depth" --asks "$asks" --sessions "$sessions" --frames "$frames" \
    --label "r$r" --arm "${arms[$i]}" --temp warm --no-header)
  c1=$(ctx "${pids[$i]}")
  printf '%s\t%s\n' "$row" "$(python3 -c "print(f'{($c1-$c0)/($asks*$sessions):.1f}')")"
}
printf 'label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\tctx_per_ask\n'
for i in "${!arms[@]}"; do run "$i" 0 >/dev/null; done
for r in $(seq 1 "$reps"); do
  if (( r % 2 )); then order=$(seq 0 $((${#arms[@]}-1))); else order=$(seq $((${#arms[@]}-1)) -1 0); fi
  for i in $order; do run "$i" "$r"; done
done
