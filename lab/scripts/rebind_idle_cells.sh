#!/usr/bin/env bash
# A1's owed number: does a session survive a path change (the relay moves its source port), and how
# long does the next ask take, with the server's idle timeout at 10 s against the default 30 s.
# rebind-probe through link_impair.py at a 40 ms round trip, arms interleaved.
# Results: docs/proposal-session-survival.md §The measurement this owes.
#
#   lab/scripts/rebind_idle_cells.sh [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ROUNDS="${1:-8}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q --release -p exact-server -p pack-study -p window-harness
BIN=target/release
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/f"
for i in $(seq 0 11); do head -c 256000 /dev/urandom > "$T/f/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 12}' > "$T/m.json"
"$BIN/pack-study" --metadata "$T/m.json" --frames "$T/f" --output "$T/s.sbnd" >/dev/null

SRV=$((36000 + RANDOM % 2000)) IN=$((34000 + RANDOM % 2000)) CTRL=$((38000 + RANDOM % 2000))
for ((r = 0; r < ROUNDS; r++)); do
  for idle in $( ((r % 2)) && echo "30000 10000" || echo "10000 30000" ); do
    RUST_LOG=exact_server=warn "$BIN/exact-server" --port "$SRV" --bind 127.0.0.1 --study "$T/s.sbnd" \
      --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" --max-idle-timeout-ms "$idle" > "$T/server.log" 2>&1 &
    srv=$!; PIDS+=("$srv")
    for _ in $(seq 100); do grep -q wt_url= "$T/server.log" && break; sleep 0.1; done
    python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms 20 --control-port "$CTRL" > "$T/relay.log" 2>&1 &
    relay=$!; PIDS+=("$relay")
    for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
    line=$("$BIN/rebind-probe" --url "https://127.0.0.1:$IN/" --control-port "$CTRL" --warm 10 --timeout-ms 40000 2>&1 | tail -1)
    kill "$relay" "$srv" 2>/dev/null || true; wait "$relay" "$srv" 2>/dev/null || true
    printf '%s\t%s\t%s\n' "$r" "$idle" "$line"
  done
done
