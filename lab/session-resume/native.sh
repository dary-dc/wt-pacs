#!/usr/bin/env bash
# RS1, natively: `cold_open` cold against `--resume` (one shared TLS session cache) through the relay
# at each round trip, arms alternating inside every round, with each dial's ClientHello read back.
#
#   lab/session-resume/native.sh [rounds] [BIN=target/release/exact-server] [RTTS="0 40 80"]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ROUNDS="${1:-7}"
BIN="${BIN:-target/release/exact-server}"
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
trap "exit 143" TERM INT

cargo build -q --release -p exact-server -p window-harness --bin cold_open
SRV=$((30000 + RANDOM % 5000))
"$BIN" --port "$SRV" --bind 127.0.0.1 --study lab/fixtures/frames_250k/frames_250k.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem > "$T/server.log" 2>&1 &
PIDS+=("$!")
declare -A IN
for rtt in ${RTTS:-0 40 80}; do
  IN[$rtt]=$((35000 + RANDOM % 5000))
  python3 lab/scripts/link_impair.py --udp "${IN[$rtt]}:$SRV" --control-port $((40000 + RANDOM % 5000)) \
    --delay-ms $((rtt / 2)) > "$T/relay-$rtt.log" 2>&1 &
  PIDS+=("$!")
done
tcpdump -i lo -U -w "$T/dials.pcap" "$(for p in "${IN[@]}"; do printf 'udp port %s or ' "$p"; done | sed 's/ or $//')" 2>/dev/null &
PIDS+=("$!")
sleep 1

for round in $(seq "$ROUNDS"); do
  for rtt in ${RTTS:-0 40 80}; do
    arms=(cold resume); (( round % 2 )) && arms=(resume cold)
    for arm in "${arms[@]}"; do
      flag=(); [[ $arm == resume ]] && flag=(--resume)
      line=$(target/release/cold_open --url "https://127.0.0.1:${IN[$rtt]}/" --rounds 1 --rtt-ms "$rtt" "${flag[@]}")
      echo "$rtt $arm $line" >> "$T/rows"
    done
  done
done
sleep 1
kill "${PIDS[-1]}"; wait "${PIDS[-1]}" 2>/dev/null || true

# Each relay's connections in dial order: a resumed arm's priming dial comes first, uncounted.
for rtt in ${RTTS:-0 40 80}; do
  python3 lab/scripts/client_hello.py "$T/dials.pcap" "${IN[$rtt]}" | sed "s/^/$rtt /"
done > "$T/hellos"
python3 - "$T/rows" "$T/hellos" <<'PY'
import collections, re, statistics, sys
rows = [l.split(" ", 2) for l in open(sys.argv[1]).read().splitlines()]
hellos = collections.defaultdict(list)
for l in open(sys.argv[2]).read().splitlines():
    hellos[l.split()[0]].append(re.search(r"psk=(\w+)", l).group(1))
psk, took = collections.defaultdict(list), collections.defaultdict(lambda: collections.defaultdict(list))
for rtt, arm, line in rows:
    seen = hellos[rtt]
    if arm == "resume":
        seen.pop(0)
    psk[(rtt, arm)].append(seen.pop(0))
    for k in ("session", "first_byte"):
        took[(rtt, arm)][k].append(float(re.search(k + r"=([\d.]+)ms", line).group(1)))
print("ms, median [min-max]; the counted dials' PSK as the server answered it")
for (rtt, arm), t in sorted(took.items(), key=lambda kv: (int(kv[0][0]), kv[0][1])):
    cell = lambda v: f"{statistics.median(v):7.1f} [{min(v):.1f}-{max(v):.1f}]"
    print(f"{rtt:>3} ms {arm:6}  session {cell(t['session'])}  first byte {cell(t['first_byte'])}"
          f"  psk {dict(collections.Counter(psk[(rtt, arm)]))}  n={len(t['session'])}")
PY
