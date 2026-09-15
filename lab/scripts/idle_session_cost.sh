#!/usr/bin/env bash
# What an idle held session costs the server: memory, CPU and packets, against session count
# and keep-alive interval. docs/transport/adr-idle-sessions.md holds the numbers.
#
#   SESSIONS="1 10 50 200" HOLD=30 lab/scripts/idle_session_cost.sh
#
# Memory and packet counts are safe in a container; CPU is reported but a container is not a
# timing rig, so the ADR marks it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)/.."
cd "$ROOT"

PORT="${PORT:-4433}"
STUDY="${STUDY:-fixtures/us_cine_smoke/us_cine_smoke.sbnd}"
SESSIONS="${SESSIONS:-1 10 50 200}"
HOLD="${HOLD:-30}"
KEEP_ALIVES="${KEEP_ALIVES:-none 3}"
IDLE_MS="${IDLE_MS:-30000}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"; [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true' EXIT

cargo build --release -p exact-server -p window-harness >/dev/null 2>&1

rss_kb()   { awk '/^VmRSS:/ {print $2}' "/proc/$1/status"; }
cpu_ticks() { awk '{print $14 + $15}' "/proc/$1/stat"; }
# Column 5 of the Udp row is OutDatagrams; system-wide, so on loopback it counts both ends.
udp_out()  { awk '/^Udp:/ {getline; print $5}' /proc/net/snmp; }

start_server() {
  ./target/release/exact-server --port "$PORT" --study "$STUDY" \
    --max-idle-timeout-ms "$IDLE_MS" >"$SCRATCH/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 50); do
    grep -q "listening\|ready\|serving" "$SCRATCH/server.log" 2>/dev/null && break
    sleep 0.2
  done
  sleep 1
}

printf '%-5s %-10s %8s %10s %10s %9s %9s\n' \
  n keep-alive rss_kb per_sess_kb cpu_ms* pkts_out per_sess
for ka in $KEEP_ALIVES; do
  for n in $SESSIONS; do
    start_server
    base_rss=$(rss_kb "$SERVER_PID"); base_cpu=$(cpu_ticks "$SERVER_PID"); base_udp=$(udp_out)

    ka_flag=()
    [[ "$ka" != "none" ]] && ka_flag=(--keep-alive-secs "$ka")
    if ! ./target/release/idle_sessions --url "https://127.0.0.1:$PORT" \
      --sessions "$n" --hold-secs "$HOLD" "${ka_flag[@]}" \
      --ready-file "$SCRATCH/ready" >"$SCRATCH/client.log" 2>&1; then
      survived="$(tail -1 "$SCRATCH/client.log")"
    else
      survived="all"
    fi

    rss=$(rss_kb "$SERVER_PID"); cpu=$(cpu_ticks "$SERVER_PID"); udp=$(udp_out)
    tick_ms=$((1000 / $(getconf CLK_TCK)))
    printf '%-5s %-10s %8s %10s %10s %9s %9s  %s\n' \
      "$n" "$ka" \
      "$((rss - base_rss))" "$(( (rss - base_rss) / n ))" \
      "$(( (cpu - base_cpu) * tick_ms ))" \
      "$((udp - base_udp))" "$(( (udp - base_udp) / n ))" \
      "$survived"

    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=
  done
done
echo "* CPU is container-measured over a ${HOLD}s hold and is not used for a decision."
