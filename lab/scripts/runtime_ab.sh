#!/usr/bin/env bash
# Interleaved A/B of two server binaries on one warm cell, both servers up for the whole run,
# arm order reversed every repeat. `docs/transport/transport-conclusions.md` §6.
#
#   lab/scripts/runtime_ab.sh <fixture> <on-demand|fill> <depth> <asks> <sessions> <repeats> \
#     <label-a> <bin-a> [server args...] -- <label-b> <bin-b> [server args...] [-- ...]
#
# One row per run, `server_ab`'s columns plus the server's context switches per ask, the
# datagrams the client's socket dropped (`Udp: RcvbufErrors`), and the server's own `session path`
# counters — packets it declared lost, datagrams per `sendmsg` — so a tail can be read against loss.
# SERVER_CPUS / CLIENT_CPUS pin the two sides (taskset lists) so a saturated cell is the server's.
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
  NO_COLOR=1 RUST_LOG=exact_server=warn,exact_server::transport::server=info ${SERVER_CPUS:+taskset -c "$SERVER_CPUS"} "${bins[$i]}" \
    --port "$port" --study "$fx" \
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
drops() { awk '/^Udp:/ {getline; print $6}' /proc/net/snmp; }
paths() { grep -c 'session path' "$1" || true; }
# Lost packets and datagrams per `sendmsg` over the `session path` lines after line $2 of log $1.
path_counters() {
  sed -n "/session path/p" "$1" | tail -n +"$(($2 + 1))" | python3 -c '
import re, sys
ls = sys.stdin.read().splitlines()
n = lambda k: sum(int(re.search(k + r"=(\d+)", l).group(1)) for l in ls)
print(n("lost"), "%.1f" % (n("datagrams_tx") / max(n("sendmsg"), 1)), sep="\t")'
}
run() {
  local i=$1 r=$2 c0 c1 d0 d1 p0 row
  c0=$(ctx "${pids[$i]}"); d0=$(drops); p0=$(paths "${logs[$i]}")
  row=$(${CLIENT_CPUS:+taskset -c "$CLIENT_CPUS"} "$ROOT/target/release/server_ab" \
    --url "https://127.0.0.1:${ports[$i]}/" --server-pid "${pids[$i]}" \
    --mode "$mode" --depth "$depth" --asks "$asks" --sessions "$sessions" --frames "$frames" \
    --label "r$r" --arm "${arms[$i]}" --temp warm --no-header)
  c1=$(ctx "${pids[$i]}"); d1=$(drops)
  for _ in $(seq 1 40); do (( $(paths "${logs[$i]}") - p0 >= sessions )) && break; sleep 0.05; done
  printf '%s\t%s\t%s\t%s\n' "$row" "$(python3 -c "print(f'{($c1-$c0)/($asks*$sessions):.1f}')")" "$((d1-d0))" \
    "$(path_counters "${logs[$i]}" "$p0")"
}
printf 'label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\tctx_per_ask\trcvbuf_drops\tserver_lost\tdatagrams_per_sendmsg\n'
for i in "${!arms[@]}"; do run "$i" 0 >/dev/null; done
for r in $(seq 1 "$reps"); do
  if (( r % 2 )); then order=$(seq 0 $((${#arms[@]}-1))); else order=$(seq $((${#arms[@]}-1)) -1 0); fi
  for i in $order; do run "$i" "$r"; done
done
